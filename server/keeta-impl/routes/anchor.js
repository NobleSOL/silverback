// server/keeta-impl/routes/anchor.js
// Silverback Anchor API endpoints for quote and swap execution

import { Router } from 'express';
import { getSilverbackAnchorService } from '../services/anchor-service.js';
import { createKeetaClientFromSeed } from '../utils/client.js';

const router = Router();
const anchorService = getSilverbackAnchorService();

/**
 * POST /api/anchor/quote
 * Get quote from Silverback anchor pools
 *
 * Body: {
 *   tokenIn: string,
 *   tokenOut: string,
 *   amountIn: string (bigint as string),
 *   decimalsIn: number,
 *   decimalsOut: number
 * }
 */
router.post('/quote', async (req, res) => {
  try {
    const { tokenIn, tokenOut, amountIn, decimalsIn, decimalsOut } = req.body;

    // Validate inputs
    if (!tokenIn || !tokenOut || !amountIn) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: tokenIn, tokenOut, amountIn',
      });
    }

    console.log(`📊 Silverback anchor quote requested: ${tokenIn.slice(-8)} → ${tokenOut.slice(-8)}, amount: ${amountIn}`);

    // Convert amountIn string to bigint
    const amountInBigInt = BigInt(amountIn);

    // Get quote from Silverback anchor service
    const quote = await anchorService.getQuote(
      tokenIn,
      tokenOut,
      amountInBigInt,
      decimalsIn || 9,
      decimalsOut || 9
    );

    if (!quote) {
      return res.json({
        success: false,
        message: 'No Silverback pools available for this pair',
      });
    }

    res.json({
      success: true,
      quote,
    });
  } catch (error) {
    console.error('❌ Anchor quote error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get quote',
    });
  }
});

/**
 * POST /api/anchor/swap
 * Execute swap through Silverback anchor pool
 *
 * Body: {
 *   quote: object (from quote endpoint),
 *   userAddress: string
 * }
 */
router.post('/swap', async (req, res) => {
  try {
    const { quote, userAddress } = req.body;

    // Validate inputs
    if (!quote || !userAddress) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: quote, userAddress',
      });
    }

    if (!quote.poolAddress) {
      return res.status(400).json({
        success: false,
        error: 'Invalid quote: missing poolAddress',
      });
    }

    console.log(`🔄 Silverback anchor swap TX2 requested by ${userAddress.slice(-8)}`);

    // Execute TX2 through anchor service
    // (User has already signed and sent TX1 in the frontend)
    const result = await anchorService.executeSwapTX2(quote, userAddress);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Swap execution failed',
      });
    }

    res.json({
      success: true,
      amountOut: result.amountOut,
      poolAddress: result.poolAddress,
      provider: result.provider,
    });
  } catch (error) {
    console.error('❌ Anchor swap error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to execute swap',
    });
  }
});

export default router;
