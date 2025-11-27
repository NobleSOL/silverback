// server/keeta-impl/services/anchor-service.js
// Silverback FX Anchor Service - provides quotes from user-created anchor pools

import { getAnchorRepository } from '../db/anchor-repository.js';
import { getOpsClient, accountFromAddress, getTokenBalance } from '../utils/client.js';
import { fetchTokenDecimals } from '../utils/client.js';

/**
 * Silverback Anchor Service
 * Provides FX anchor quotes from user-created pools
 */
export class SilverbackAnchorService {
  constructor() {
    this.repository = getAnchorRepository();
    this.MINIMUM_LIQUIDITY = 1000n; // Min liquidity for quoting (like Uniswap)
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
        console.log(`⚠️ No Silverback anchor pools found for pair`);
        return null;
      }

      console.log(`🔍 Found ${pools.length} Silverback anchor pool(s) for quote`);

      // Get quotes from all pools
      const quotes = await Promise.all(
        pools.map(pool => this.getPoolQuote(pool, tokenIn, tokenOut, amountIn, decimalsIn, decimalsOut))
      );

      // Filter out null quotes (pools with insufficient liquidity)
      const validQuotes = quotes.filter(q => q !== null);

      if (validQuotes.length === 0) {
        console.log(`⚠️ No Silverback pools have sufficient liquidity`);
        return null;
      }

      // Sort by best output amount (descending)
      validQuotes.sort((a, b) => {
        if (b.amountOut > a.amountOut) return 1;
        if (b.amountOut < a.amountOut) return -1;
        return 0;
      });

      // Return best quote
      const bestQuote = validQuotes[0];
      console.log(`✅ Best Silverback quote: ${bestQuote.amountOutFormatted} ${bestQuote.symbolOut} (fee: ${bestQuote.feeBps / 100}%)`);

      return bestQuote;
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

      console.log(`   Pool ${pool.pool_address.slice(-8)}: Reserve In: ${reserveIn}, Reserve Out: ${reserveOut}`);

      // Check minimum liquidity
      if (reserveIn === 0n || reserveOut === 0n) {
        console.log(`   ⏭️  Skipping pool ${pool.pool_address.slice(-8)}: No liquidity`);
        return null;
      }

      if (reserveIn < this.MINIMUM_LIQUIDITY || reserveOut < this.MINIMUM_LIQUIDITY) {
        console.log(`   ⏭️  Skipping pool ${pool.pool_address.slice(-8)}: Below minimum liquidity`);
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
   * Execute TX2 of a swap (backend accepts swap request after user created it in TX1)
   * User must have already created swap request via TX1
   *
   * @param {Object} quote - Quote object from getQuote()
   * @param {string} userAddress - User's wallet address
   * @param {string} swapBlockHash - Hash of the swap request block from TX1
   * @returns {Promise<Object>} Swap result
   */
  async executeSwapTX2(quote, userAddress, swapBlockHash) {
    try {
      const opsClient = await getOpsClient();

      console.log(`🔄 Executing Silverback anchor swap TX2...`);
      console.log(`   Pool: ${quote.poolAddress.slice(-8)}`);
      console.log(`   Amount In: ${quote.amountInFormatted} ${quote.symbolIn}`);
      console.log(`   Expected Out: ${quote.amountOutFormatted} ${quote.symbolOut}`);
      console.log(`   Swap block hash: ${swapBlockHash || 'N/A'}`);

      // Convert string amounts back to BigInt for blockchain operations
      const amountInBigInt = BigInt(quote.amountIn);
      const amountOutBigInt = BigInt(quote.amountOut);

      // Get the swap request block from the user
      // For now, we'll use the simpler approach: query recent blocks from user's account
      const KeetaNet = await import('@keetanetwork/keetanet-client');
      const userAccount = KeetaNet.lib.Account.fromPublicKeyString(userAddress);

      // Query user's recent history to find the swap request
      const history = await opsClient.history(userAccount, { limit: 10 });

      // Find the swap request block (should be the most recent)
      let swapBlock = null;
      for (const block of history) {
        if (block.type === 'swap_request' || (swapBlockHash && block.hash.toString('hex') === swapBlockHash)) {
          swapBlock = block;
          break;
        }
      }

      if (!swapBlock) {
        throw new Error('Swap request block not found in user history');
      }

      console.log(`📝 TX2: Accepting swap request...`);

      // TX2: OPS accepts the swap request (pool completes the swap)
      const acceptResult = await opsClient.acceptSwapRequest(
        {
          block: swapBlock,
          expected: {
            amount: amountInBigInt,
            token: quote.tokenIn
          }
        },
        { account: accountFromAddress(quote.poolAddress) }
      );

      console.log(`✅ TX2 swap accepted`);

      // Record swap in database
      await this.repository.recordAnchorSwap({
        poolAddress: quote.poolAddress,
        tokenIn: quote.tokenIn,
        tokenOut: quote.tokenOut,
        amountIn: amountInBigInt,
        amountOut: amountOutBigInt,
        feeCollected: amountInBigInt - (amountInBigInt * (10000n - BigInt(quote.feeBps))) / 10000n,
        userAddress,
      });

      console.log(`✅ Silverback anchor swap completed successfully`);

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
