// src/routes/wallet.js
import { Router } from 'express';
import { randomBytes } from 'crypto';
import { lib } from '@keetanetwork/keetanet-client';
import { getBalances, fetchTokenMetadata } from '../utils/client.js';

const router = Router();

/**
 * Helper function to fetch and format token balances
 */
async function fetchFormattedBalances(address) {
  try {
    const rawBalances = await getBalances(address);

    // Format balances with decimals and symbols from on-chain metadata
    const formattedTokens = await Promise.all(
      rawBalances.map(async (b) => {
        const metadata = await fetchTokenMetadata(b.token);
        const balanceFormatted = Number(b.balance) / (10 ** metadata.decimals);

        return {
          address: b.token,
          symbol: metadata.symbol, // Use symbol from fetchTokenMetadata (has fallback logic)
          balance: b.balance.toString(),
          balanceFormatted: balanceFormatted.toFixed(metadata.decimals),
          decimals: metadata.decimals
        };
      })
    );

    return formattedTokens;
  } catch (error) {
    console.error('Error fetching balances:', error);
    return [];
  }
}

router.post('/', async (req, res) => {
  try {
    const { action = 'generate', seed: providedSeed } = req.body;
    let seed;
    let address;

    if (action === 'generate') {
      // Generate a random 32-byte seed
      const randomSeed = randomBytes(32);
      seed = randomSeed.toString('hex');

      // Derive Keeta account from seed
      const account = lib.Account.fromSeed(Buffer.from(seed, 'hex'), 0);
      address = account.publicKeyString.get();

      // Fetch token balances
      const tokens = await fetchFormattedBalances(address);

      res.json({
        success: true,
        address,
        seed,
        tokens,
        message: 'Wallet generated successfully'
      });
    } else if (action === 'import') {
      // Validate seed is provided
      if (!providedSeed) {
        return res.status(400).json({
          success: false,
          error: 'Seed is required for import'
        });
      }

      // Validate seed format (64 hex characters)
      if (!/^[0-9a-fA-F]{64}$/.test(providedSeed)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid seed format. Must be 64 hex characters'
        });
      }

      seed = providedSeed;

      // Derive Keeta account from provided seed
      const account = lib.Account.fromSeed(Buffer.from(seed, 'hex'), 0);
      address = account.publicKeyString.get();

      // Fetch token balances
      const tokens = await fetchFormattedBalances(address);

      res.json({
        success: true,
        address,
        seed,
        tokens,
        message: 'Wallet imported successfully'
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Invalid action. Must be "generate" or "import"'
      });
    }
  } catch (error) {
    console.error('Wallet route error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
