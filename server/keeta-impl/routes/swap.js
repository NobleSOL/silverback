// src/routes/swap.js
import express from 'express';
import { getPoolManager } from '../contracts/PoolManager.js';
import { toAtomic } from '../utils/constants.js';
import { fetchTokenDecimals } from '../utils/client.js';

const router = express.Router();

/**
 * POST /api/swap/quote
 * Get a quote for a swap without executing
 * 
 * Body: {
 *   tokenIn: string,
 *   tokenOut: string,
 *   amountIn: string (human-readable)
 * }
 */
router.post('/quote', async (req, res) => {
  try {
    const { tokenIn, tokenOut, amountIn } = req.body;

    console.log('📊 Swap quote request:', { tokenIn: tokenIn?.slice(0, 20) + '...', tokenOut: tokenOut?.slice(0, 20) + '...', amountIn, amountInType: typeof amountIn });

    if (!tokenIn || !tokenOut || !amountIn) {
      return res.status(400).json({
        error: 'Missing required fields: tokenIn, tokenOut, amountIn',
      });
    }

    const poolManager = await getPoolManager();

    // Get decimals for input token
    const decimals = await fetchTokenDecimals(tokenIn);
    const amountInAtomic = toAtomic(Number(amountIn), decimals);

    console.log('💱 Converting amount:', { amountIn, decimals, amountInAtomic: amountInAtomic.toString() });

    // Get quote
    const quote = await poolManager.getSwapQuote(tokenIn, tokenOut, amountInAtomic);

    res.json({
      success: true,
      quote,
    });
  } catch (error) {
    console.error('Swap quote error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/swap/execute
 * Execute a swap
 * 
 * Body: {
 *   userAddress: string,
 *   tokenIn: string,
 *   tokenOut: string,
 *   amountIn: string (human-readable),
 *   minAmountOut?: string (human-readable),
 *   slippagePercent?: number (default 0.5)
 * }
 */
router.post('/execute', async (req, res) => {
  try {
    console.log('🔄 Swap execute request body:', JSON.stringify(req.body, null, 2));

    const {
      userAddress,
      userSeed,
      tokenIn,
      tokenOut,
      amountIn,
      minAmountOut,
      slippagePercent = 0.5,
    } = req.body;

    console.log('📝 Extracted fields:', {
      hasUserAddress: !!userAddress,
      hasUserSeed: !!userSeed,
      hasTokenIn: !!tokenIn,
      hasTokenOut: !!tokenOut,
      hasAmountIn: !!amountIn
    });

    if (!userAddress || !tokenIn || !tokenOut || !amountIn || !userSeed) {
      console.log('❌ Missing required fields');
      return res.status(400).json({
        error: 'Missing required fields: userAddress, userSeed, tokenIn, tokenOut, amountIn',
      });
    }

    const poolManager = await getPoolManager();

    // Convert amounts to atomic
    const decimalsIn = await fetchTokenDecimals(tokenIn);
    const decimalsOut = await fetchTokenDecimals(tokenOut);
    const amountInAtomic = toAtomic(Number(amountIn), decimalsIn);

    let minAmountOutAtomic = 0n;
    if (minAmountOut) {
      minAmountOutAtomic = toAtomic(Number(minAmountOut), decimalsOut);
    }

    // Create user client
    const { createUserClient } = await import('../utils/client.js');
    const { client: userClient } = createUserClient(userSeed);

    // Execute swap
    const result = await poolManager.swap(
      userClient,
      userAddress,
      tokenIn,
      tokenOut,
      amountInAtomic,
      minAmountOutAtomic
    );

    const response = {
      success: true,
      result: {
        amountOut: result.amountOut.toString(),
        feeAmount: result.feeAmount.toString(),
        priceImpact: result.priceImpact,
        newReserveA: result.newReserveA.toString(),
        newReserveB: result.newReserveB.toString(),
        blockHash: result.blockHash,
      },
    };

    console.log('📤 Swap API response:', JSON.stringify(response, null, 2));
    res.json(response);
  } catch (error) {
    console.error('Swap execution error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
