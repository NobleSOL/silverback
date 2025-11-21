// server/keeta-impl/utils/apy-calculator.js
import { PoolRepository } from '../db/pool-repository.js';

/**
 * Calculate pool APY based on 24h reserve growth
 *
 * Logic:
 * - LP fees (0.25% of swaps) accumulate in pool reserves
 * - Compare current reserves to 24h ago snapshot
 * - Derive trading volume from reserve growth
 * - Calculate APY from fee earnings vs TVL
 */
export class APYCalculator {
  constructor() {
    this.repository = new PoolRepository();
  }

  /**
   * Calculate APY for a single pool
   * @param {string} poolAddress - Pool address
   * @param {bigint} currentReserveA - Current reserve A
   * @param {bigint} currentReserveB - Current reserve B
   * @param {number} decimalsA - Token A decimals
   * @param {number} decimalsB - Token B decimals
   * @param {string} tokenA - Token A address
   * @param {string} tokenB - Token B address
   * @returns {Promise<{ apy: number, volume24h: number, tvl: number }>}
   */
  async calculatePoolAPY(poolAddress, currentReserveA, currentReserveB, decimalsA, decimalsB, tokenA, tokenB) {
    try {
      // Get snapshot from 24 hours ago
      const snapshot24h = await this.repository.getSnapshotAt(poolAddress, 24);

      if (!snapshot24h) {
        // No snapshot available yet - return 0
        return {
          apy: 0,
          volume24h: 0,
          tvl: await this.calculateTVL(currentReserveA, currentReserveB, decimalsA, decimalsB, tokenA, tokenB),
          reason: 'No 24h snapshot available yet',
        };
      }

      // Parse snapshot reserves (stored as strings in database)
      const oldReserveA = BigInt(snapshot24h.reserve_a);
      const oldReserveB = BigInt(snapshot24h.reserve_b);

      // Calculate reserve growth (in token A terms)
      const reserveAGrowth = currentReserveA > oldReserveA
        ? currentReserveA - oldReserveA
        : 0n;

      // If no growth, APY is 0
      if (reserveAGrowth === 0n) {
        return {
          apy: 0,
          volume24h: 0,
          tvl: await this.calculateTVL(currentReserveA, currentReserveB, decimalsA, decimalsB, tokenA, tokenB),
          reason: 'No reserve growth in 24h',
        };
      }

      // Calculate TVL (Total Value Locked) in USD
      const tvl = await this.calculateTVL(currentReserveA, currentReserveB, decimalsA, decimalsB, tokenA, tokenB);

      // Get token A price for volume calculation
      const { calculateTokenPrices } = await import('../routes/pricing.js');
      const prices = await calculateTokenPrices([tokenA]);
      const priceA = prices[tokenA]?.priceUsd || 0;

      // Calculate volume in USD
      // Reserve growth is the 0.25% LP fee that stayed in the pool
      // So: growth = volume × 0.0025
      // Therefore: volume = growth / 0.0025
      const reserveAGrowthNum = Number(reserveAGrowth) / Math.pow(10, decimalsA);
      const volume24hTokens = reserveAGrowthNum / 0.0025; // Volume in token A
      const volume24h = volume24hTokens * priceA; // Volume in USD

      // Calculate APY
      // Daily fees to LPs (0.25% of volume, which is what stayed in reserves as growth)
      const dailyFees = reserveAGrowthNum * priceA; // Growth in USD
      const annualFees = dailyFees * 365;
      const apy = tvl > 0 ? (annualFees / tvl) * 100 : 0;

      return {
        apy: parseFloat(apy.toFixed(2)),
        volume24h: parseFloat(volume24h.toFixed(2)),
        tvl: parseFloat(tvl.toFixed(2)),
        snapshot_time: snapshot24h.snapshot_time,
      };
    } catch (error) {
      console.error(`Error calculating APY for pool ${poolAddress.slice(-8)}:`, error.message);
      return {
        apy: 0,
        volume24h: 0,
        tvl: await this.calculateTVL(currentReserveA, currentReserveB, decimalsA, decimalsB, tokenA, tokenB),
        error: error.message,
      };
    }
  }

  /**
   * Calculate TVL (Total Value Locked) in USD
   * Fetches token prices from pricing API and converts both reserves to USD
   *
   * @param {bigint} reserveA - Reserve of token A
   * @param {bigint} reserveB - Reserve of token B
   * @param {number} decimalsA - Token A decimals
   * @param {number} decimalsB - Token B decimals
   * @param {string} tokenA - Token A address
   * @param {string} tokenB - Token B address
   * @returns {Promise<number>} - TVL in USD
   */
  async calculateTVL(reserveA, reserveB, decimalsA, decimalsB, tokenA, tokenB) {
    try {
      // Import pricing calculator
      const { default: pricingRouter } = await import('../routes/pricing.js');

      // Fetch prices for both tokens (internal call)
      const { calculateTokenPrices } = await import('../routes/pricing.js');
      const prices = await calculateTokenPrices([tokenA, tokenB]);

      // Convert reserves to human-readable amounts
      const reserveANum = Number(reserveA) / Math.pow(10, decimalsA);
      const reserveBNum = Number(reserveB) / Math.pow(10, decimalsB);

      // Calculate USD value for each side
      const priceA = prices[tokenA]?.priceUsd || 0;
      const priceB = prices[tokenB]?.priceUsd || 0;

      const valueA = reserveANum * priceA;
      const valueB = reserveBNum * priceB;

      // TVL is sum of both sides
      const tvl = valueA + valueB;

      return tvl;
    } catch (error) {
      console.warn('Failed to calculate TVL in USD, using fallback:', error.message);

      // Fallback: estimate using reserve A × 2 (assumes equal value pools)
      const reserveANum = Number(reserveA) / Math.pow(10, decimalsA);
      return reserveANum * 2;
    }
  }

  /**
   * Calculate APY for all pools
   * @param {Array<Object>} pools - Array of pool objects with reserves and decimals
   * @returns {Promise<Map<string, Object>>} - Map of pool address to APY data
   */
  async calculateAllPoolsAPY(pools) {
    const apyData = new Map();

    for (const pool of pools) {
      const apy = await this.calculatePoolAPY(
        pool.poolAddress,
        pool.reserveA,
        pool.reserveB,
        pool.decimalsA,
        pool.decimalsB
      );

      apyData.set(pool.poolAddress, apy);
    }

    return apyData;
  }
}

/**
 * Standalone function to calculate pool APY
 */
export async function calculatePoolAPY(poolAddress, currentReserveA, currentReserveB, decimalsA, decimalsB, tokenA, tokenB) {
  const calculator = new APYCalculator();
  return await calculator.calculatePoolAPY(poolAddress, currentReserveA, currentReserveB, decimalsA, decimalsB, tokenA, tokenB);
}
