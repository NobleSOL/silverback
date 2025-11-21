/**
 * Swap Router Service
 * Handles intelligent routing between Silverback direct swaps and aggregator swaps
 * Always picks the best price for the user while collecting appropriate fees
 */

import { ethers } from 'ethers';
import type { Address } from 'viem';

export interface SwapRoute {
  router: 'silverback' | 'aggregator';
  routerAddress: Address;
  amountOut: string;
  amountOutHuman: number;
  priceImpact: number;
  fee: string;
  source: string;
  gas: bigint;
}

export interface SwapQuoteParams {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: string;
  slippage: number;
  userAddress: Address;
}

export class SwapRouterService {
  private factoryV0Address: Address;
  private routerV0Address: Address;
  private unifiedRouterAddress: Address;
  private provider: ethers.BrowserProvider;

  constructor(
    factoryV0: Address,
    routerV0: Address,
    unifiedRouter: Address,
    provider: ethers.BrowserProvider
  ) {
    this.factoryV0Address = factoryV0;
    this.routerV0Address = routerV0;
    this.unifiedRouterAddress = unifiedRouter;
    this.provider = provider;
  }

  /**
   * Check if a Silverback pair exists for the token pair
   */
  async hasSilverbackPair(tokenA: Address, tokenB: Address): Promise<boolean> {
    try {
      const factory = new ethers.Contract(
        this.factoryV0Address,
        ['function getPair(address,address) view returns (address)'],
        this.provider
      );

      const pairAddress = await factory.getPair(tokenA, tokenB);
      return pairAddress !== ethers.ZeroAddress;
    } catch (error) {
      console.error('Error checking Silverback pair:', error);
      return false;
    }
  }

  /**
   * Get quote from Silverback RouterV0 (0% router fee, 0.3% pair fee)
   */
  async getSilverbackQuote(
    tokenIn: Address,
    tokenOut: Address,
    amountIn: string
  ): Promise<SwapRoute | null> {
    try {
      const router = new ethers.Contract(
        this.routerV0Address,
        [
          'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)',
          'function factory() view returns (address)',
        ],
        this.provider
      );

      // Check if pair exists first
      const hasPair = await this.hasSilverbackPair(tokenIn, tokenOut);
      if (!hasPair) return null;

      // Get quote
      const amounts = await router.getAmountsOut(amountIn, [tokenIn, tokenOut]);
      const amountOut = amounts[1].toString();
      const amountOutHuman = parseFloat(ethers.formatUnits(amountOut, 18));

      // Calculate price impact (simplified)
      const amountInHuman = parseFloat(ethers.formatUnits(amountIn, 18));
      const expectedOut = amountInHuman * 0.997; // 0.3% fee
      const priceImpact = ((expectedOut - amountOutHuman) / expectedOut) * 100;

      return {
        router: 'silverback',
        routerAddress: this.routerV0Address,
        amountOut,
        amountOutHuman,
        priceImpact: Math.abs(priceImpact),
        fee: '0.3%',
        source: 'Silverback V2',
        gas: 150000n, // Estimated gas
      };
    } catch (error) {
      console.error('Error getting Silverback quote:', error);
      return null;
    }
  }

  /**
   * Get quote from aggregator (OpenOcean, 1inch, etc.)
   * Note: Includes 0.3% router fee charged by UnifiedRouter
   */
  async getAggregatorQuote(
    tokenIn: Address,
    tokenOut: Address,
    amountIn: string,
    slippage: number,
    chainId: number
  ): Promise<SwapRoute | null> {
    try {
      // Fetch quote from OpenOcean API
      const params = new URLSearchParams({
        inTokenAddress: tokenIn,
        outTokenAddress: tokenOut,
        amount: amountIn,
        gasPrice: '5',
        slippage: slippage.toString(),
        account: this.unifiedRouterAddress, // Router will forward
      });

      const response = await fetch(
        `https://open-api.openocean.finance/v3/${chainId}/swap_quote?${params}`
      );

      if (!response.ok) return null;

      const data = await response.json();
      if (!data.data) return null;

      // Calculate net output after 0.3% router fee
      const grossAmountOut = data.data.outAmount;
      const routerFee = (BigInt(grossAmountOut) * 3n) / 1000n; // 0.3%
      const netAmountOut = BigInt(grossAmountOut) - routerFee;

      return {
        router: 'aggregator',
        routerAddress: this.unifiedRouterAddress,
        amountOut: netAmountOut.toString(),
        amountOutHuman: parseFloat(ethers.formatUnits(netAmountOut, 18)),
        priceImpact: parseFloat(data.data.priceImpact || '0'),
        fee: '0.3% router + aggregator fees',
        source: data.data.dex || 'Aggregator',
        gas: BigInt(data.data.estimatedGas || 250000),
      };
    } catch (error) {
      console.error('Error getting aggregator quote:', error);
      return null;
    }
  }

  /**
   * Get best route by comparing all available options
   */
  async getBestRoute(params: SwapQuoteParams, chainId: number): Promise<SwapRoute | null> {
    const routes: SwapRoute[] = [];

    // Get Silverback quote (if pair exists)
    const silverbackQuote = await this.getSilverbackQuote(
      params.tokenIn,
      params.tokenOut,
      params.amountIn
    );
    if (silverbackQuote) {
      routes.push(silverbackQuote);
    }

    // Get aggregator quote
    const aggregatorQuote = await this.getAggregatorQuote(
      params.tokenIn,
      params.tokenOut,
      params.amountIn,
      params.slippage,
      chainId
    );
    if (aggregatorQuote) {
      routes.push(aggregatorQuote);
    }

    // No routes available
    if (routes.length === 0) return null;

    // Sort by amountOut (best price first)
    routes.sort((a, b) => {
      return parseFloat(b.amountOut) - parseFloat(a.amountOut);
    });

    // Return best route
    return routes[0];
  }

  /**
   * Execute swap using the selected route
   */
  async executeSwap(
    route: SwapRoute,
    params: SwapQuoteParams,
    signer: ethers.Signer
  ): Promise<ethers.ContractTransactionResponse> {
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes

    if (route.router === 'silverback') {
      // Use RouterV0 for direct Silverback swap
      const router = new ethers.Contract(
        route.routerAddress,
        [
          'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)',
        ],
        signer
      );

      const minAmountOut = (BigInt(route.amountOut) * BigInt(10000 - params.slippage * 100)) / 10000n;

      return await router.swapExactTokensForTokens(
        params.amountIn,
        minAmountOut.toString(),
        [params.tokenIn, params.tokenOut],
        params.userAddress,
        deadline
      );
    } else {
      // Use UnifiedRouter for aggregated swap
      // TODO: Implement swapAndForward call with aggregator data
      throw new Error('Aggregator swaps via UnifiedRouter not yet implemented in executeSwap');
    }
  }
}

/**
 * Create swap router service instance
 */
export function createSwapRouter(
  factoryV0: Address,
  routerV0: Address,
  unifiedRouter: Address,
  provider: ethers.BrowserProvider
): SwapRouterService {
  return new SwapRouterService(factoryV0, routerV0, unifiedRouter, provider);
}
