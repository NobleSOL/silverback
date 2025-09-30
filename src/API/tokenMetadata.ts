import 'dotenv/config';
import express from 'express';
import * as KeetaNet from '@keetanetwork/keetanet-client';

const router = express.Router();

const NETWORK = (process.env.NETWORK || 'test') as 'test' | 'dev' | 'staging' | 'main';

// --- Fetch metadata (decimals + symbol) ---
async function getTokenMetadata(client: any, tokenAddr: string) {
  try {
    const token = KeetaNet.lib.Account.fromPublicKeyString(tokenAddr);
    const tokenInfo = await client.getAccountInfo(token);

    let decimals = 0;
    let symbol = '';

    if (tokenInfo?.info?.metadata) {
      const metaObj = JSON.parse(
        Buffer.from(tokenInfo.info.metadata, 'base64').toString()
      );

      if (metaObj.decimalPlaces !== undefined) {
        decimals = Number(metaObj.decimalPlaces);
      }
      if (metaObj.symbol !== undefined) {
        symbol = metaObj.symbol;
      }
    }

    return { decimals, symbol };
  } catch (err) {
    console.error('Metadata fetch error:', err);
    throw new Error('Failed to fetch metadata');
  }
}

// --- Endpoint ---
router.get('/token-metadata', async (req, res) => {
  const { address } = req.query;
  if (!address || typeof address !== 'string') {
    return res.status(400).json({ error: 'Missing token address' });
  }

  try {
    const ops = KeetaNet.lib.Account.fromSeed(
      Buffer.from(process.env.OPS_SEED!, 'hex'),
      0
    );
    const client = KeetaNet.UserClient.fromNetwork(NETWORK, ops);

    const meta = await getTokenMetadata(client, address);
    res.json(meta);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
