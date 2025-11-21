// Token transfer API
import express from 'express';
import { createUserClient } from '../utils/client.js';
import { accountFromAddress } from '../utils/anchor.js';
import { toAtomic } from '../utils/constants.js';
import { fetchTokenDecimals } from '../utils/client.js';

const router = express.Router();

/**
 * POST /api/transfer/send
 * Send tokens from one address to another
 *
 * Body: {
 *   senderSeed: string (hex),
 *   recipientAddress: string,
 *   tokenAddress: string,
 *   amount: string (human-readable)
 * }
 */
router.post('/send', async (req, res) => {
  try {
    const { senderSeed, recipientAddress, tokenAddress, amount } = req.body;

    console.log('💸 Transfer request:', {
      recipient: recipientAddress?.slice(0, 20) + '...',
      token: tokenAddress?.slice(0, 20) + '...',
      amount,
    });

    if (!senderSeed || !recipientAddress || !tokenAddress || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: senderSeed, recipientAddress, tokenAddress, amount',
      });
    }

    // Create user client
    const { client, address: senderAddress } = createUserClient(senderSeed);

    // Get token decimals
    const decimals = await fetchTokenDecimals(tokenAddress);
    const amountAtomic = toAtomic(Number(amount), decimals);

    console.log('💱 Converting amount:', {
      amount,
      decimals,
      amountAtomic: amountAtomic.toString(),
    });

    // Get recipient account
    const recipientAccount = accountFromAddress(recipientAddress);
    const tokenAccount = accountFromAddress(tokenAddress);

    // Execute transfer
    console.log('🚀 Executing transfer...');
    const result = await client.send(
      recipientAccount,
      amountAtomic,
      tokenAccount
    );

    console.log('✅ Transfer successful:', result);

    // Convert result to string to handle BigInt serialization
    const resultString = typeof result === 'object' ? JSON.stringify(result, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    ) : String(result);

    res.json({
      success: true,
      txHash: result?.txHash || resultString,
      sender: senderAddress,
      recipient: recipientAddress,
      token: tokenAddress,
      amount: amount,
    });
  } catch (error) {
    console.error('❌ Transfer error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
