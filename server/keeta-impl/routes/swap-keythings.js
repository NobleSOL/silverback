// Keythings wallet swap endpoint
// Completes swaps after user has sent tokens via TX1 (signed in Keythings)
import express from 'express';
import { getPoolManager } from '../contracts/PoolManager.js';
import { getOpsClient, accountFromAddress } from '../utils/client.js';
import { markTX2Complete, markTX2Failed } from '../db/transaction-state.js';
import { executeTX2WithRetry } from '../utils/retry.js';

const router = express.Router();

/**
 * Helper: Load pool on-demand if not in memory
 * Prevents "Pool not found" errors when async pool discovery is still running
 */
async function getPoolInstance(poolManager, poolAddress) {
  // Check in-memory first
  let pool = Array.from(poolManager.pools.values()).find(
    (p) => p.poolAddress === poolAddress
  );

  // If not in memory, load from database on-demand
  if (!pool) {
    console.log(`⚠️ Pool ${poolAddress.slice(-8)} not in memory, loading from database...`);

    try {
      const poolData = await poolManager.repository.getPoolByAddress(poolAddress);

      if (poolData) {
        const { Pool } = await import('../contracts/Pool.js');
        const { getPairKey } = await import('../utils/constants.js');

        pool = new Pool(
          poolData.pool_address,
          poolData.token_a,
          poolData.token_b,
          poolData.lp_token_address,
          null,
          poolManager.repository
        );
        await pool.initialize();

        // Cache it for future requests
        const pairKey = getPairKey(poolData.token_a, poolData.token_b);
        poolManager.pools.set(pairKey, pool);

        console.log(`✅ Pool loaded on-demand: ${poolAddress.slice(-8)}`);
      }
    } catch (dbError) {
      console.error(`❌ Failed to load pool from database:`, dbError);
    }
  }

  if (!pool) {
    throw new Error(`Pool not found in memory or database: ${poolAddress}`);
  }

  return pool;
}

/**
 * POST /api/swap/keythings/preflight
 * Validate that swap TX2 will succeed before user signs TX1
 * CRITICAL: Prevents fund loss by checking backend readiness before TX1
 *
 * Body: {
 *   userAddress: string,
 *   poolAddress: string,
 *   tokenIn: string,
 *   tokenOut: string,
 *   amountIn: string (atomic units)
 * }
 *
 * Returns: {
 *   canProceed: true/false,
 *   reason: string (if canProceed=false),
 *   estimatedOutput: string (if canProceed=true),
 *   priceImpact: number (if canProceed=true)
 * }
 */
router.post('/preflight', async (req, res) => {
  try {
    const { userAddress, poolAddress, tokenIn, tokenOut, amountIn } = req.body;

    console.log('🔍 Preflight validation for swap...');
    console.log(`   Pool: ${poolAddress?.slice(0, 12)}...`);
    console.log(`   Amount In: ${amountIn}`);

    // Validate required fields
    if (!userAddress || !poolAddress || !tokenIn || !tokenOut || !amountIn) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
      });
    }

    // 1. Check if OPS client is available
    try {
      const opsClient = await getOpsClient();
      if (!opsClient) {
        return res.json({
          success: true,
          canProceed: false,
          reason: 'Backend service temporarily unavailable',
        });
      }
    } catch (error) {
      return res.json({
        success: true,
        canProceed: false,
        reason: 'Backend service unavailable',
      });
    }

    // 2. Check if pool exists
    const poolManager = await getPoolManager();
    let pool;
    try {
      pool = await getPoolInstance(poolManager, poolAddress);
    } catch (error) {
      return res.json({
        success: true,
        canProceed: false,
        reason: 'Pool not found',
      });
    }

    // 3. Validate pool has liquidity
    await pool.updateReserves();
    const reserveIn = pool.tokenA === tokenIn ? BigInt(pool.reserveA) : BigInt(pool.reserveB);
    const reserveOut = pool.tokenA === tokenIn ? BigInt(pool.reserveB) : BigInt(pool.reserveA);

    if (reserveIn === 0n || reserveOut === 0n) {
      return res.json({
        success: true,
        canProceed: false,
        reason: 'Pool has no liquidity',
      });
    }

    // 4. Calculate swap output
    const amountInBigInt = BigInt(amountIn);
    const amountInWithFee = amountInBigInt * 997n;
    const numerator = amountInWithFee * reserveOut;
    const denominator = reserveIn * 1000n + amountInWithFee;
    const amountOut = numerator / denominator;

    if (amountOut === 0n || amountOut >= reserveOut) {
      return res.json({
        success: true,
        canProceed: false,
        reason: 'Insufficient liquidity for this amount',
      });
    }

    // 5. Calculate price impact
    const priceImpact = Number((amountOut * 10000n) / reserveOut) / 100;

    console.log(`✅ Preflight passed: Output ${amountOut}, Impact ${priceImpact.toFixed(2)}%`);

    return res.json({
      success: true,
      canProceed: true,
      estimatedOutput: amountOut.toString(),
      priceImpact: Number(priceImpact.toFixed(2)),
      warning: priceImpact > 5 ? `High price impact: ${priceImpact.toFixed(2)}%` : null,
    });
  } catch (error) {
    console.error('❌ Preflight error:', error);
    return res.json({
      success: true,
      canProceed: false,
      reason: `Validation failed: ${error.message}`,
    });
  }
});

/**
 * POST /api/swap/keythings/complete
 * Complete a Keythings wallet swap by sending output tokens to user
 *
 * Flow:
 * 1. User already sent TX1 via Keythings (tokenIn → pool + treasury)
 * 2. This endpoint executes TX2: pool → user (tokenOut) using SEND_ON_BEHALF
 *
 * Body: {
 *   userAddress: string,
 *   poolAddress: string,
 *   tokenOut: string,
 *   amountOut: string (atomic units as string)
 * }
 */
router.post('/complete', async (req, res) => {
  const { transactionId } = req.body; // Optional: for transaction tracking

  try {
    const { userAddress, poolAddress, tokenOut, amountOut } = req.body;

    console.log('🔄 Completing Keythings swap (TX2)...');
    console.log(`   User: ${userAddress.slice(0, 12)}...`);
    console.log(`   Pool: ${poolAddress.slice(0, 12)}...`);
    console.log(`   Token Out: ${tokenOut.slice(0, 12)}...`);
    console.log(`   Amount Out: ${amountOut}`);
    if (transactionId) {
      console.log(`   Transaction ID: ${transactionId}`);
    }

    if (!userAddress || !poolAddress || !tokenOut || !amountOut) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userAddress, poolAddress, tokenOut, amountOut',
      });
    }

    const opsClient = await getOpsClient();
    const poolManager = await getPoolManager();

    // Find or load the pool instance (with on-demand loading)
    const pool = await getPoolInstance(poolManager, poolAddress);

    // TX2: Pool sends tokenOut to user (using SEND_ON_BEHALF)
    // Wrapped in retry logic to handle transient failures
    console.log('📝 TX2: Pool sends tokenOut to user (via SEND_ON_BEHALF)...');

    const tokenOutAccount = accountFromAddress(tokenOut);
    const userAccount = accountFromAddress(userAddress);
    const poolAccount = accountFromAddress(poolAddress);

    // Execute TX2 with automatic retry on failure
    const { tx2Hash } = await executeTX2WithRetry(async () => {
      const tx2Builder = opsClient.initBuilder();

      // Pool sends tokenOut to user using SEND_ON_BEHALF
      // { account: poolAccount } tells OPS to send on behalf of pool account
      tx2Builder.send(
        userAccount,
        BigInt(amountOut),
        tokenOutAccount,
        undefined,
        { account: poolAccount }
      );

      await opsClient.publishBuilder(tx2Builder);

      // Extract TX2 block hash
      let hash = null;
      if (tx2Builder.blocks && tx2Builder.blocks.length > 0) {
        const block = tx2Builder.blocks[0];
        if (block && block.hash) {
          if (typeof block.hash === 'string') {
            hash = block.hash.toUpperCase();
          } else if (block.hash.toString) {
            const hashStr = block.hash.toString();
            if (hashStr.match(/^[0-9A-Fa-f]+$/)) {
              hash = hashStr.toUpperCase();
            } else if (block.hash.toString('hex')) {
              hash = block.hash.toString('hex').toUpperCase();
            }
          }
        }
      }

      return { tx2Hash: hash };
    }, transactionId);

    console.log(`✅ TX2 completed: ${tx2Hash || 'no hash'}`);

    // Update pool reserves after swap
    await pool.updateReserves();

    // Track TX2 completion (if transaction tracking enabled)
    if (transactionId) {
      try {
        await markTX2Complete(transactionId, tx2Hash || 'unknown');
      } catch (trackingError) {
        console.warn('⚠️ Failed to track TX2 completion (non-critical):', trackingError.message);
      }
    }

    res.json({
      success: true,
      result: {
        blockHash: tx2Hash,
        amountOut: amountOut,
      },
    });
  } catch (error) {
    console.error('❌ Keythings swap completion error:', error);

    // Track TX2 failure (if transaction tracking enabled)
    if (transactionId) {
      try {
        await markTX2Failed(transactionId, error.message);
      } catch (trackingError) {
        console.warn('⚠️ Failed to track TX2 failure (non-critical):', trackingError.message);
      }
    }

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
