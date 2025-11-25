// server/keeta-impl/db/anchor-repository.js
import { getDbPool } from './client.js';
import { getPairKey } from '../utils/constants.js';

/**
 * Repository for anchor pool database operations
 */
export class AnchorRepository {
  /**
   * Save anchor pool to database
   */
  async saveAnchorPool(anchorData) {
    const pool = getDbPool();
    const { poolAddress, creatorAddress, tokenA, tokenB, feeBps } = anchorData;
    const pairKey = getPairKey(tokenA, tokenB);

    const query = `
      INSERT INTO anchor_pools (pool_address, creator_address, token_a, token_b, pair_key, fee_bps, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (pool_address)
      DO UPDATE SET
        fee_bps = EXCLUDED.fee_bps,
        status = EXCLUDED.status,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;

    const values = [poolAddress, creatorAddress, tokenA, tokenB, pairKey, feeBps || 30, 'active'];
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Load all active anchor pools from database
   */
  async loadAnchorPools() {
    const pool = getDbPool();
    const query = 'SELECT * FROM anchor_pools WHERE status = $1 ORDER BY created_at ASC;';
    const result = await pool.query(query, ['active']);
    return result.rows;
  }

  /**
   * Get anchor pool by pair key
   */
  async getAnchorPoolByPairKey(tokenA, tokenB) {
    const pool = getDbPool();
    const pairKey = getPairKey(tokenA, tokenB);
    const query = 'SELECT * FROM anchor_pools WHERE pair_key = $1 AND status = $2;';
    const result = await pool.query(query, [pairKey, 'active']);
    return result.rows; // Return array since multiple users can create pools for same pair
  }

  /**
   * Get anchor pool by address
   */
  async getAnchorPoolByAddress(poolAddress) {
    const pool = getDbPool();
    const query = 'SELECT * FROM anchor_pools WHERE pool_address = $1;';
    const result = await pool.query(query, [poolAddress]);
    return result.rows[0] || null;
  }

  /**
   * Get all anchor pools created by a user
   */
  async getAnchorPoolsByCreator(creatorAddress) {
    const pool = getDbPool();
    const query = 'SELECT * FROM anchor_pools WHERE creator_address = $1 ORDER BY created_at DESC;';
    const result = await pool.query(query, [creatorAddress]);
    return result.rows;
  }

  /**
   * Update anchor pool status (active, paused, closed)
   */
  async updateAnchorPoolStatus(poolAddress, status) {
    const pool = getDbPool();
    const query = `
      UPDATE anchor_pools
      SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE pool_address = $2
      RETURNING *;
    `;
    const result = await pool.query(query, [status, poolAddress]);
    return result.rows[0];
  }

  /**
   * Update anchor pool fee
   */
  async updateAnchorPoolFee(poolAddress, feeBps) {
    const pool = getDbPool();
    const query = `
      UPDATE anchor_pools
      SET fee_bps = $1, updated_at = CURRENT_TIMESTAMP
      WHERE pool_address = $2
      RETURNING *;
    `;
    const result = await pool.query(query, [feeBps, poolAddress]);
    return result.rows[0];
  }

  /**
   * Delete anchor pool
   */
  async deleteAnchorPool(poolAddress) {
    const pool = getDbPool();
    const query = 'DELETE FROM anchor_pools WHERE pool_address = $1;';
    await pool.query(query, [poolAddress]);
  }

  /**
   * Save anchor pool snapshot for APY tracking
   */
  async saveAnchorSnapshot(poolAddress, reserveA, reserveB) {
    const pool = getDbPool();
    const query = `
      INSERT INTO anchor_pool_snapshots (pool_address, reserve_a, reserve_b)
      VALUES ($1, $2, $3)
      ON CONFLICT (pool_address, snapshot_time)
      DO NOTHING
      RETURNING *;
    `;
    const values = [poolAddress, reserveA.toString(), reserveB.toString()];
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Get latest snapshot for an anchor pool (for 24h comparison)
   */
  async getAnchorSnapshotAt(poolAddress, hoursAgo) {
    const pool = getDbPool();
    const query = `
      SELECT * FROM anchor_pool_snapshots
      WHERE pool_address = $1
        AND snapshot_time <= NOW() - INTERVAL '${hoursAgo} hours'
      ORDER BY snapshot_time DESC
      LIMIT 1;
    `;
    const result = await pool.query(query, [poolAddress]);
    return result.rows[0] || null;
  }

  /**
   * Record an anchor swap
   */
  async recordAnchorSwap(swapData) {
    const pool = getDbPool();
    const {
      poolAddress,
      tokenIn,
      tokenOut,
      amountIn,
      amountOut,
      feeCollected,
      txHash,
      blockHeight,
      userAddress,
    } = swapData;

    const query = `
      INSERT INTO anchor_swaps (
        pool_address, token_in, token_out, amount_in, amount_out,
        fee_collected, tx_hash, block_height, user_address
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `;

    const values = [
      poolAddress,
      tokenIn,
      tokenOut,
      amountIn.toString(),
      amountOut.toString(),
      feeCollected.toString(),
      txHash || null,
      blockHeight || null,
      userAddress || null,
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Get swap history for an anchor pool
   */
  async getAnchorSwapHistory(poolAddress, limit = 100) {
    const pool = getDbPool();
    const query = `
      SELECT * FROM anchor_swaps
      WHERE pool_address = $1
      ORDER BY swap_time DESC
      LIMIT $2;
    `;
    const result = await pool.query(query, [poolAddress, limit]);
    return result.rows;
  }

  /**
   * Get 24h volume for an anchor pool
   */
  async getAnchor24hVolume(poolAddress) {
    const pool = getDbPool();
    const query = `
      SELECT
        COUNT(*) as swap_count,
        SUM(CAST(amount_in AS NUMERIC)) as total_volume_in,
        SUM(CAST(fee_collected AS NUMERIC)) as total_fees
      FROM anchor_swaps
      WHERE pool_address = $1
        AND swap_time >= NOW() - INTERVAL '24 hours';
    `;
    const result = await pool.query(query, [poolAddress]);
    return result.rows[0];
  }

  /**
   * Get user's swap history across all anchor pools
   */
  async getUserAnchorSwaps(userAddress, limit = 50) {
    const pool = getDbPool();
    const query = `
      SELECT s.*, p.token_a, p.token_b, p.creator_address
      FROM anchor_swaps s
      JOIN anchor_pools p ON s.pool_address = p.pool_address
      WHERE s.user_address = $1
      ORDER BY s.swap_time DESC
      LIMIT $2;
    `;
    const result = await pool.query(query, [userAddress, limit]);
    return result.rows;
  }
}

// Singleton instance
let instance = null;

/**
 * Get singleton instance of AnchorRepository
 */
export function getAnchorRepository() {
  if (!instance) {
    instance = new AnchorRepository();
  }
  return instance;
}
