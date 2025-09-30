// src/server.ts
import 'dotenv/config';
import express from 'express';
import * as KeetaNet from '@keetanetwork/keetanet-client';

const PORT = process.env.PORT || 3001;
const NETWORK = process.env.NETWORK || 'test';

// ✅ Use Client (no signer required, safe for read-only metadata fetches)
const client = KeetaNet.Client.fromNetwork(NETWORK);

const app = express();

// --- Token metadata endpoint ---
app.get('/token/:address', async (req, res) => {
  const { address } = req.params;

  try {
    const tokenAccount = KeetaNet.lib.Account.fromPublicKeyString(address);
    const tokenInfo = await client.getAccountInfo(tokenAccount);

    let decimals = 0;
let symbol = 'UNKNOWN';

if (tokenInfo?.info?.metadata) {
  try {
    const metaObj = JSON.parse(
      Buffer.from(tokenInfo.info.metadata, 'base64').toString()
    );

    if (metaObj.decimalPlaces !== undefined) {
      decimals = Number(metaObj.decimalPlaces);
    }
    if (metaObj.symbol) {
      symbol = metaObj.symbol;
    }
  } catch (e) {
    console.warn('⚠️ Failed to parse token metadata', e);
  }
}

// 🔄 fallback to `info.name` if symbol missing
if (symbol === 'UNKNOWN' && tokenInfo?.info?.name) {
  symbol = tokenInfo.info.name;
}

    res.json({ address, decimals, symbol });
  } catch (err: any) {
    console.error('❌ Error fetching token info:', err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`🚀 Silverback DEX API running on http://localhost:${PORT}`);
});
