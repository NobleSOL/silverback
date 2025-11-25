// src/routes/anchor-pools.js
// API endpoints for user-created FX anchor pools

import express from 'express';
import { getAnchorRepository } from '../db/anchor-repository.js';
import { createStorageAccount, createLPToken, getOpsClient } from '../utils/client.js';
import { getPairKey } from '../utils/constants.js';

const router = express.Router();

/**
 * GET /api/anchor-pools
 * Get all active anchor pools
 */
router.get('/', async (req, res) => {
  try {
    const repository = getAnchorRepository();
    const pools = await repository.loadAnchorPools();

    // Enhance with runtime data (reserves, APY, etc.)
    const enhancedPools = await Promise.all(
      pools.map(async (pool) => {
        try {
          // Fetch 24h volume
          const volumeData = await repository.getAnchor24hVolume(pool.pool_address);

          return {
            ...pool,
            volume24h: volumeData?.total_volume_in || '0',
            swapCount24h: volumeData?.swap_count || 0,
            feesCollected24h: volumeData?.total_fees || '0',
          };
        } catch (error) {
          console.warn(`Failed to fetch volume for pool ${pool.pool_address}:`, error.message);
          return pool;
        }
      })
    );

    res.json({
      success: true,
      pools: enhancedPools,
      count: enhancedPools.length,
    });
  } catch (error) {
    console.error('Get anchor pools error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/anchor-pools/creator/:address
 * Get all anchor pools created by a specific user
 */
router.get('/creator/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const repository = getAnchorRepository();
    const pools = await repository.getAnchorPoolsByCreator(address);

    res.json({
      success: true,
      pools,
      count: pools.length,
    });
  } catch (error) {
    console.error('Get creator pools error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/anchor-pools/:tokenA/:tokenB
 * Get all anchor pools for a specific token pair
 */
router.get('/:tokenA/:tokenB', async (req, res) => {
  try {
    const { tokenA, tokenB } = req.params;
    const repository = getAnchorRepository();
    const pools = await repository.getAnchorPoolByPairKey(tokenA, tokenB);

    res.json({
      success: true,
      pools,
      count: pools.length,
    });
  } catch (error) {
    console.error('Get pair pools error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/anchor-pools/create
 * Create a new user anchor pool
 *
 * Body: {
 *   creatorAddress: string,
 *   tokenA: string,
 *   tokenB: string,
 *   feeBps?: number (default 30 = 0.3%)
 * }
 */
router.post('/create', async (req, res) => {
  try {
    const { creatorAddress, tokenA, tokenB, amountA, amountB, feeBps = 30 } = req.body;

    if (!creatorAddress || !tokenA || !tokenB || !amountA || !amountB) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: creatorAddress, tokenA, tokenB, amountA, amountB',
      });
    }

    // Validate amounts
    if (Number(amountA) <= 0 || Number(amountB) <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Amounts must be greater than 0',
      });
    }

    if (tokenA === tokenB) {
      return res.status(400).json({
        success: false,
        error: 'Cannot create anchor pool with same token',
      });
    }

    // Validate fee (must be between 1-1000 bps = 0.01% to 10%)
    if (feeBps < 1 || feeBps > 1000) {
      return res.status(400).json({
        success: false,
        error: 'Fee must be between 1 and 1000 basis points (0.01% to 10%)',
      });
    }

    const repository = getAnchorRepository();
    const pairKey = getPairKey(tokenA, tokenB);

    // Check if user already has an anchor pool for this pair
    const existingPools = await repository.getAnchorPoolsByCreator(creatorAddress);
    const duplicatePool = existingPools.find(p => p.pair_key === pairKey);

    if (duplicatePool) {
      return res.status(409).json({
        success: false,
        error: 'You already have an anchor pool for this token pair',
        existingPool: duplicatePool,
      });
    }

    // Fetch token symbols for pool name
    const { fetchTokenMetadata } = await import('../utils/client.js');
    const [metadataA, metadataB] = await Promise.all([
      fetchTokenMetadata(tokenA),
      fetchTokenMetadata(tokenB),
    ]);
    const symbolA = metadataA.symbol || 'TKA';
    const symbolB = metadataB.symbol || 'TKB';

    // Create storage account for anchor pool
    // Creator owns the pool, OPS has routing permissions
    console.log(`🏊 Creating anchor pool for ${symbolA}/${symbolB}...`);
    const poolAddress = await createStorageAccount(
      'SILVERBACK_ANCHOR',
      `FX Anchor pool for ${symbolA}/${symbolB}`,
      true,
      creatorAddress
    );

    console.log(`✅ Anchor pool created at ${poolAddress}`);

    // Create LP token for the anchor pool (same as AMM pools)
    console.log(`   Creating LP token for anchor pool...`);
    const lpTokenAddress = await createLPToken(poolAddress, tokenA, tokenB);
    console.log(`   ✅ LP token created: ${lpTokenAddress}`);

    // Save to database
    await repository.saveAnchorPool({
      poolAddress,
      creatorAddress,
      tokenA,
      tokenB,
      feeBps,
    });

    console.log(`✅ Anchor pool saved to database`);

    res.json({
      success: true,
      message: 'Anchor pool created successfully',
      pool: {
        poolAddress,
        lpTokenAddress,
        creatorAddress,
        tokenA,
        tokenB,
        amountA,
        amountB,
        feeBps,
        symbolA,
        symbolB,
      },
    });
  } catch (error) {
    console.error('Create anchor pool error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/anchor-pools/:poolAddress/mint-lp
 * Mint LP tokens after initial liquidity is added
 * (Anchor pool version - separate from regular AMM pools)
 *
 * Body: {
 *   creatorAddress: string,
 *   amountA: string,
 *   amountB: string
 * }
 */
router.post('/:poolAddress/mint-lp', async (req, res) => {
  try {
    const { poolAddress } = req.params;
    const { creatorAddress, amountA, amountB } = req.body;

    if (!creatorAddress || !amountA || !amountB) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: creatorAddress, amountA, amountB',
      });
    }

    const repository = getAnchorRepository();
    const pool = await repository.getAnchorPoolByAddress(poolAddress);

    if (!pool) {
      return res.status(404).json({
        success: false,
        error: 'Anchor pool not found',
      });
    }

    // Verify creator ownership
    if (pool.creator_address !== creatorAddress) {
      return res.status(403).json({
        success: false,
        error: 'Only pool creator can mint initial LP tokens',
      });
    }

    // Calculate LP tokens to mint (geometric mean: sqrt(amountA * amountB))
    const amountABigInt = BigInt(amountA);
    const amountBBigInt = BigInt(amountB);
    const lpTokenAmount = sqrt(amountABigInt * amountBBigInt);

    console.log(`💎 Minting ${lpTokenAmount} LP tokens for anchor pool ${poolAddress.slice(-8)}...`);

    // Mint LP tokens to creator
    const { mintLPTokens } = await import('../utils/client.js');
    await mintLPTokens(pool.lp_token_address, creatorAddress, lpTokenAmount);

    console.log(`✅ LP tokens minted successfully`);

    res.json({
      success: true,
      message: 'LP tokens minted successfully',
      lpTokenAmount: lpTokenAmount.toString(),
    });
  } catch (error) {
    console.error('Mint LP tokens error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Helper: Integer square root for LP token calculation
function sqrt(value) {
  if (value < 0n) {
    throw new Error('Square root of negative numbers is not supported');
  }
  if (value < 2n) {
    return value;
  }

  function newtonIteration(n, x0) {
    const x1 = ((n / x0) + x0) >> 1n;
    if (x0 === x1 || x0 === (x1 - 1n)) {
      return x0;
    }
    return newtonIteration(n, x1);
  }

  return newtonIteration(value, 1n);
}

/**
 * POST /api/anchor-pools/:poolAddress/update-fee
 * Update anchor pool fee
 *
 * Body: {
 *   creatorAddress: string,
 *   feeBps: number
 * }
 */
router.post('/:poolAddress/update-fee', async (req, res) => {
  try {
    const { poolAddress } = req.params;
    const { creatorAddress, feeBps } = req.body;

    if (!creatorAddress || feeBps === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: creatorAddress, feeBps',
      });
    }

    // Validate fee
    if (feeBps < 1 || feeBps > 1000) {
      return res.status(400).json({
        success: false,
        error: 'Fee must be between 1 and 1000 basis points (0.01% to 10%)',
      });
    }

    const repository = getAnchorRepository();
    const pool = await repository.getAnchorPoolByAddress(poolAddress);

    if (!pool) {
      return res.status(404).json({
        success: false,
        error: 'Anchor pool not found',
      });
    }

    // Verify ownership
    if (pool.creator_address !== creatorAddress) {
      return res.status(403).json({
        success: false,
        error: 'Only the pool creator can update fees',
      });
    }

    // Update fee
    const updated = await repository.updateAnchorPoolFee(poolAddress, feeBps);

    res.json({
      success: true,
      message: 'Fee updated successfully',
      pool: updated,
    });
  } catch (error) {
    console.error('Update fee error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/anchor-pools/:poolAddress/update-status
 * Update anchor pool status (active, paused, closed)
 *
 * Body: {
 *   creatorAddress: string,
 *   status: 'active' | 'paused' | 'closed'
 * }
 */
router.post('/:poolAddress/update-status', async (req, res) => {
  try {
    const { poolAddress } = req.params;
    const { creatorAddress, status } = req.body;

    if (!creatorAddress || !status) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: creatorAddress, status',
      });
    }

    if (!['active', 'paused', 'closed'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Status must be one of: active, paused, closed',
      });
    }

    const repository = getAnchorRepository();
    const pool = await repository.getAnchorPoolByAddress(poolAddress);

    if (!pool) {
      return res.status(404).json({
        success: false,
        error: 'Anchor pool not found',
      });
    }

    // Verify ownership
    if (pool.creator_address !== creatorAddress) {
      return res.status(403).json({
        success: false,
        error: 'Only the pool creator can update status',
      });
    }

    // Update status
    const updated = await repository.updateAnchorPoolStatus(poolAddress, status);

    res.json({
      success: true,
      message: `Pool status updated to ${status}`,
      pool: updated,
    });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/anchor-pools/:poolAddress/swaps
 * Get swap history for an anchor pool
 */
router.get('/:poolAddress/swaps', async (req, res) => {
  try {
    const { poolAddress } = req.params;
    const { limit = 100 } = req.query;

    const repository = getAnchorRepository();
    const swaps = await repository.getAnchorSwapHistory(poolAddress, parseInt(limit));

    res.json({
      success: true,
      swaps,
      count: swaps.length,
    });
  } catch (error) {
    console.error('Get swaps error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/anchor-pools/:poolAddress/volume
 * Get 24h volume for an anchor pool
 */
router.get('/:poolAddress/volume', async (req, res) => {
  try {
    const { poolAddress } = req.params;

    const repository = getAnchorRepository();
    const volumeData = await repository.getAnchor24hVolume(poolAddress);

    res.json({
      success: true,
      volume24h: volumeData?.total_volume_in || '0',
      swapCount: volumeData?.swap_count || 0,
      feesCollected: volumeData?.total_fees || '0',
    });
  } catch (error) {
    console.error('Get volume error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
