// server/keeta-impl/services/anchor-service.js
// Silverback FX Anchor Service - provides quotes from user-created anchor pools

import { getAnchorRepository } from '../db/anchor-repository.js';
import { getOpsClient, accountFromAddress, getTokenBalance, getTreasuryAccount } from '../utils/client.js';
import { fetchTokenDecimals } from '../utils/client.js';

/**
 * Silverback Anchor Service
 * Provides FX anchor quotes from user-created pools
 */
export class SilverbackAnchorService {
  constructor() {
    this.repository = getAnchorRepository();
    this.MINIMUM_LIQUIDITY = 1000n; // Min liquidity for quoting (like Uniswap)
    this.PROTOCOL_FEE_BPS = 5n; // 0.05% protocol fee (5 basis points)
  }

  /**
   * Get quote for a swap through Silverback anchor pools
   * Returns best quote from all available user-created pools
   *
   * @param {string} tokenIn - Input token address
   * @param {string} tokenOut - Output token address
   * @param {bigint} amountIn - Amount to swap (atomic units)
   * @param {number} decimalsIn - Input token decimals
   * @param {number} decimalsOut - Output token decimals
   * @returns {Promise<Object | null>} Quote object or null if no pools available
   */
  async getQuote(tokenIn, tokenOut, amountIn, decimalsIn, decimalsOut) {
    try {
      // Find all active anchor pools for this token pair
      const pools = await this.repository.getAnchorPoolByPairKey(tokenIn, tokenOut);

      if (!pools || pools.length === 0) {
        return null;
      }

      // Get quotes from all pools
      const quotes = await Promise.all(
        pools.map(pool => this.getPoolQuote(pool, tokenIn, tokenOut, amountIn, decimalsIn, decimalsOut))
      );

      // Filter out null quotes (pools with insufficient liquidity)
      const validQuotes = quotes.filter(q => q !== null);

      if (validQuotes.length === 0) {
        return null;
      }

      // Sort by best output amount (descending) and return best quote
      validQuotes.sort((a, b) => {
        if (b.amountOut > a.amountOut) return 1;
        if (b.amountOut < a.amountOut) return -1;
        return 0;
      });

      return validQuotes[0];
    } catch (error) {
      console.error('❌ Silverback anchor quote error:', error);
      return null;
    }
  }

  /**
   * Get quote from a single anchor pool
   */
  async getPoolQuote(pool, tokenIn, tokenOut, amountIn, decimalsIn, decimalsOut) {
    try {
      const opsClient = await getOpsClient();

      // Determine token order in pool
      const isTokenAIn = pool.token_a === tokenIn;
      const tokenInPool = isTokenAIn ? pool.token_a : pool.token_b;
      const tokenOutPool = isTokenAIn ? pool.token_b : pool.token_a;

      // Get pool reserves
      const reserveIn = await getTokenBalance(pool.pool_address, tokenInPool);
      const reserveOut = await getTokenBalance(pool.pool_address, tokenOutPool);

      // Check minimum liquidity
      if (reserveIn === 0n || reserveOut === 0n ||
          reserveIn < this.MINIMUM_LIQUIDITY || reserveOut < this.MINIMUM_LIQUIDITY) {
        return null;
      }

      // Calculate output amount using constant product formula (x * y = k)
      // amountOut = (amountIn * reserveOut) / (reserveIn + amountIn)
      // But with fee: amountInWithFee = amountIn * (10000 - feeBps) / 10000

      const feeBps = BigInt(pool.fee_bps);
      const amountInWithFee = (amountIn * (10000n - feeBps)) / 10000n;

      const numerator = amountInWithFee * reserveOut;
      const denominator = reserveIn + amountInWithFee;
      const amountOut = numerator / denominator;

      // Calculate price impact
      const priceImpact = Number((amountIn * 10000n) / reserveIn) / 100;

      // Format amounts
      const amountInFormatted = (Number(amountIn) / Math.pow(10, decimalsIn)).toFixed(6);
      const amountOutFormatted = (Number(amountOut) / Math.pow(10, decimalsOut)).toFixed(6);
      const feeFormatted = (Number(amountIn - amountInWithFee) / Math.pow(10, decimalsIn)).toFixed(6);

      return {
        provider: 'Silverback',
        poolAddress: pool.pool_address,
        creatorAddress: pool.creator_address,
        tokenIn,
        tokenOut,
        amountIn: amountIn.toString(), // Convert BigInt to string for JSON serialization
        amountOut: amountOut.toString(), // Convert BigInt to string for JSON serialization
        amountInFormatted,
        amountOutFormatted,
        fee: feeFormatted,
        feeBps: pool.fee_bps,
        priceImpact,
        symbolIn: await this.getTokenSymbol(tokenIn),
        symbolOut: await this.getTokenSymbol(tokenOut),
      };
    } catch (error) {
      console.error(`❌ Error getting quote from pool ${pool.pool_address}:`, error);
      return null;
    }
  }

  /**
   * Execute TX2 of a swap (backend completes swap after user signed TX1)
   * User must have already sent tokens to pool via TX1
   *
   * @param {Object} quote - Quote object from getQuote()
   * @param {string} userAddress - User's wallet address
   * @returns {Promise<Object>} Swap result
   */
  async executeSwapTX2(quote, userAddress) {
    try {
      const opsClient = await getOpsClient();

      const poolAccount = accountFromAddress(quote.poolAddress);
      const tokenOutAccount = accountFromAddress(quote.tokenOut);
      const userAccount = accountFromAddress(userAddress);
      const treasuryAccount = getTreasuryAccount();

      // Convert string amounts back to BigInt for blockchain operations
      const amountInBigInt = BigInt(quote.amountIn);
      const amountOutBigInt = BigInt(quote.amountOut);

      // Calculate protocol fee (0.05% of output amount)
      const protocolFee = (amountOutBigInt * this.PROTOCOL_FEE_BPS) / 10000n;
      const amountToUser = amountOutBigInt - protocolFee;

      // TX2: OPS sends tokenOut from pool - protocol fee to treasury, rest to user
      // (User has already sent tokenIn to pool via TX1 in frontend)
      const tx2Builder = opsClient.initBuilder();

      // Send protocol fee to treasury
      if (protocolFee > 0n) {
        tx2Builder.send(
          treasuryAccount,
          protocolFee,
          tokenOutAccount,
          undefined,
          { account: poolAccount }
        );
      }

      // Send remaining amount to user
      tx2Builder.send(
        userAccount,
        amountToUser,
        tokenOutAccount,
        undefined,
        { account: poolAccount }
      );

      await opsClient.publishBuilder(tx2Builder);

      // Calculate pool creator fee (their fee percentage)
      const poolCreatorFee = amountInBigInt - (amountInBigInt * (10000n - BigInt(quote.feeBps))) / 10000n;

      // Record swap in database
      await this.repository.recordAnchorSwap({
        poolAddress: quote.poolAddress,
        tokenIn: quote.tokenIn,
        tokenOut: quote.tokenOut,
        amountIn: amountInBigInt,
        amountOut: amountOutBigInt,
        feeCollected: poolCreatorFee,
        protocolFee: protocolFee,
        userAddress,
      });

      return {
        success: true,
        amountOut: quote.amountOutFormatted,
        poolAddress: quote.poolAddress,
        provider: 'Silverback',
      };
    } catch (error) {
      console.error('❌ Silverback anchor swap error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get all available Silverback anchor pools
   * Useful for displaying available markets
   */
  async getAvailablePools() {
    try {
      const pools = await this.repository.loadAnchorPools();

      // Enhance with reserve data
      const enhancedPools = await Promise.all(
        pools.map(async (pool) => {
          try {
            const [reserveA, reserveB] = await Promise.all([
              getTokenBalance(pool.pool_address, pool.token_a),
              getTokenBalance(pool.pool_address, pool.token_b),
            ]);

            const [decimalsA, decimalsB] = await Promise.all([
              fetchTokenDecimals(pool.token_a),
              fetchTokenDecimals(pool.token_b),
            ]);

            return {
              ...pool,
              reserveA: reserveA.toString(),
              reserveB: reserveB.toString(),
              reserveAFormatted: (Number(reserveA) / Math.pow(10, decimalsA)).toFixed(6),
              reserveBFormatted: (Number(reserveB) / Math.pow(10, decimalsB)).toFixed(6),
            };
          } catch (error) {
            console.warn(`Failed to get reserves for pool ${pool.pool_address}:`, error.message);
            return pool;
          }
        })
      );

      return enhancedPools;
    } catch (error) {
      console.error('Error getting Silverback pools:', error);
      return [];
    }
  }

  /**
   * Helper: Get token symbol
   */
  async getTokenSymbol(tokenAddress) {
    try {
      const { fetchTokenMetadata } = await import('../utils/client.js');
      const metadata = await fetchTokenMetadata(tokenAddress);
      return metadata.symbol;
    } catch (error) {
      return tokenAddress.slice(0, 8);
    }
  }
}

// Singleton instance
let anchorServiceInstance = null;

/**
 * Get singleton instance of SilverbackAnchorService
 */
export function getSilverbackAnchorService() {
  if (!anchorServiceInstance) {
    anchorServiceInstance = new SilverbackAnchorService();
  }
  return anchorServiceInstance;
}
