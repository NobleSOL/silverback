// server/keeta-impl/utils/snapshot-recorder.js
import { getPoolManager } from '../contracts/PoolManager.js';
import { PoolRepository } from '../db/pool-repository.js';

/**
 * Records reserve snapshots for all active pools
 * Used for APY calculation based on 24h reserve growth
 */
export class SnapshotRecorder {
  constructor() {
    this.repository = new PoolRepository();
  }

  /**
   * Record snapshots for all pools
   * @returns {Promise<{ success: number, failed: number, errors: Array }>}
   */
  async recordAllSnapshots() {
    console.log('📸 Starting snapshot recording for all pools...');

    const results = {
      success: 0,
      failed: 0,
      errors: []
    };

    try {
      // Get pool manager instance
      const poolManager = await getPoolManager();
      const pools = poolManager.getAllPools();

      console.log(`   Found ${pools.length} pools to snapshot`);

      // Record snapshot for each pool
      for (const pool of pools) {
        try {
          // Skip pools without LP tokens (legacy pools)
          if (!pool.lpTokenAddress) {
            console.log(`   ⏭️  Skipping legacy pool without LP token: ${pool.poolAddress.slice(-8)}`);
            continue;
          }

          // Get current reserves (already loaded during pool initialization)
          const reserveA = pool.reserveA;
          const reserveB = pool.reserveB;

          // Skip if reserves are not loaded
          if (!reserveA || !reserveB) {
            console.log(`   ⚠️  Pool ${pool.poolAddress.slice(-8)} has no reserves loaded, skipping`);
            continue;
          }

          // Save snapshot to database
          const snapshot = await this.repository.saveSnapshot(
            pool.poolAddress,
            reserveA,
            reserveB
          );

          if (snapshot) {
            console.log(`   ✅ Snapshot saved for pool ${pool.poolAddress.slice(-8)}: ${reserveA} / ${reserveB}`);
            results.success++;
          } else {
            // ON CONFLICT DO NOTHING - snapshot already exists for this time
            console.log(`   ℹ️  Snapshot already exists for pool ${pool.poolAddress.slice(-8)}`);
            results.success++;
          }
        } catch (error) {
          console.error(`   ❌ Error saving snapshot for pool ${pool.poolAddress.slice(-8)}:`, error.message);
          results.failed++;
          results.errors.push({
            poolAddress: pool.poolAddress,
            error: error.message
          });
        }
      }

      console.log(`\n📊 Snapshot recording complete:`);
      console.log(`   ✅ Success: ${results.success}`);
      console.log(`   ❌ Failed: ${results.failed}`);

      return results;
    } catch (error) {
      console.error('❌ Fatal error during snapshot recording:', error);
      throw error;
    }
  }

  /**
   * Record snapshot for a single pool
   * @param {string} poolAddress - Pool address
   * @returns {Promise<Object>}
   */
  async recordSnapshot(poolAddress) {
    console.log(`📸 Recording snapshot for pool ${poolAddress.slice(-8)}...`);

    try {
      // Get pool manager and find the pool
      const poolManager = await getPoolManager();
      const pool = poolManager.getPoolByAddress(poolAddress);

      if (!pool) {
        throw new Error(`Pool not found: ${poolAddress}`);
      }

      // Get current reserves
      const reserveA = pool.reserveA;
      const reserveB = pool.reserveB;

      if (!reserveA || !reserveB) {
        throw new Error(`Pool has no reserves loaded`);
      }

      // Save snapshot
      const snapshot = await this.repository.saveSnapshot(
        poolAddress,
        reserveA,
        reserveB
      );

      console.log(`✅ Snapshot saved: ${reserveA} / ${reserveB}`);
      return snapshot;
    } catch (error) {
      console.error(`❌ Error recording snapshot:`, error.message);
      throw error;
    }
  }

  /**
   * Clean up old snapshots (keep last 30 days by default)
   * @param {number} daysToKeep - Number of days of snapshots to keep
   * @returns {Promise<number>} - Number of snapshots deleted
   */
  async cleanOldSnapshots(daysToKeep = 30) {
    console.log(`🧹 Cleaning snapshots older than ${daysToKeep} days...`);

    try {
      const deletedCount = await this.repository.cleanOldSnapshots(daysToKeep);
      console.log(`✅ Deleted ${deletedCount} old snapshots`);
      return deletedCount;
    } catch (error) {
      console.error(`❌ Error cleaning old snapshots:`, error.message);
      throw error;
    }
  }
}

/**
 * Standalone function to record snapshots (for use in scripts)
 */
export async function recordSnapshots() {
  const recorder = new SnapshotRecorder();
  return await recorder.recordAllSnapshots();
}
