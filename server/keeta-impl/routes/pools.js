// src/routes/pools.js
import express from 'express';
import { getPoolManager } from '../contracts/PoolManager.js';
import { APYCalculator } from '../utils/apy-calculator.js';

const router = express.Router();

/**
 * GET /api/pools
 * Get all pools with APY data
 */
router.get('/', async (req, res) => {
  try {
    const poolManager = await getPoolManager();
    const allPools = await poolManager.getAllPoolsInfo();

    // Calculate APY for each pool
    const apyCalculator = new APYCalculator();
    const poolsWithAPY = await Promise.all(
      allPools.map(async (pool) => {
        // Calculate APY using current reserves
        const apyData = await apyCalculator.calculatePoolAPY(
          pool.poolAddress,
          BigInt(pool.reserveA),
          BigInt(pool.reserveB),
          pool.decimalsA,
          pool.decimalsB,
          pool.tokenA,
          pool.tokenB
        );

        // Add APY data to pool object
        return {
          ...pool,
          apy: apyData.apy,
          volume24h: apyData.volume24h,
          tvl: apyData.tvl,
        };
      })
    );

    // Return all pools (including empty ones so users can add liquidity)
    res.json({
      success: true,
      pools: poolsWithAPY,
      count: poolsWithAPY.length,
    });
  } catch (error) {
    console.error('Get pools error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/pools/:tokenA/:tokenB
 * Get specific pool info
 */
router.get('/:tokenA/:tokenB', async (req, res) => {
  try {
    const { tokenA, tokenB } = req.params;

    const poolManager = await getPoolManager();
    const pool = poolManager.getPool(tokenA, tokenB);

    if (!pool) {
      return res.status(404).json({
        success: false,
        error: 'Pool not found',
      });
    }

    const info = await pool.getPoolInfo();

    res.json({
      success: true,
      pool: info,
    });
  } catch (error) {
    console.error('Get pool error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/pools/create
 * Create a new pool (permissionless)
 *
 * Body: {
 *   tokenA: string,
 *   tokenB: string,
 *   userSeed?: string (64-char hex seed) OR creatorAddress?: string
 * }
 */
router.post('/create', async (req, res) => {
  try {
    const { tokenA, tokenB, creatorAddress, userSeed } = req.body;

    if (!tokenA || !tokenB) {
      return res.status(400).json({
        error: 'Missing required fields: tokenA, tokenB',
      });
    }

    // Derive creator address from userSeed if provided, otherwise use creatorAddress
    let finalCreatorAddress = creatorAddress;
    if (userSeed && !finalCreatorAddress) {
      const { createUserClient } = await import('../utils/client.js');
      const { address } = createUserClient(userSeed);
      finalCreatorAddress = address;
    }

    if (!finalCreatorAddress) {
      return res.status(400).json({
        error: 'Missing required field: creatorAddress or userSeed',
      });
    }

    if (tokenA === tokenB) {
      return res.status(400).json({
        error: 'Cannot create pool with same token',
      });
    }

    const poolManager = await getPoolManager();

    // Check if pool already exists
    if (poolManager.hasPool(tokenA, tokenB)) {
      return res.status(409).json({
        success: false,
        error: 'Pool already exists',
      });
    }

    // Create pool with creator address for ownership transfer
    const pool = await poolManager.createPool(tokenA, tokenB, finalCreatorAddress);
    const info = await pool.getPoolInfo();

    res.json({
      success: true,
      message: 'Pool created successfully',
      pool: info,
    });
  } catch (error) {
    console.error('Create pool error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/pools/:tokenA/:tokenB/stats
 * Get pool statistics
 */
router.get('/:tokenA/:tokenB/stats', async (req, res) => {
  try {
    const { tokenA, tokenB } = req.params;

    const poolManager = await getPoolManager();
    const stats = await poolManager.getPoolStats(tokenA, tokenB);

    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error('Get pool stats error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/pools/exists/:tokenA/:tokenB
 * Check if a pool exists
 */
router.get('/exists/:tokenA/:tokenB', async (req, res) => {
  try {
    const { tokenA, tokenB } = req.params;

    const poolManager = await getPoolManager();
    const exists = poolManager.hasPool(tokenA, tokenB);

    res.json({
      success: true,
      exists,
    });
  } catch (error) {
    console.error('Check pool exists error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/pools/debug/loaded
 * Debug endpoint to see what pools are loaded in memory
 */
router.get('/debug/loaded', async (req, res) => {
  try {
    const poolManager = await getPoolManager();

    const loadedPools = [];
    for (const [pairKey, pool] of poolManager.pools.entries()) {
      loadedPools.push({
        pairKey,
        poolAddress: pool.poolAddress,
        tokenA: pool.tokenA,
        tokenB: pool.tokenB,
        lpTokenAddress: pool.lpTokenAddress,
        creator: pool.creator,
      });
    }

    res.json({
      success: true,
      totalPools: loadedPools.length,
      pools: loadedPools,
    });
  } catch (error) {
    console.error('Debug pools error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
