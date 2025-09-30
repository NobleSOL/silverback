// src/testDecimals.ts
import 'dotenv/config';
import * as KeetaNet from '@keetanetwork/keetanet-client';

const NETWORK = (process.env.NETWORK || 'test') as 'test' | 'dev' | 'staging' | 'main';

// Example token — replace or pass via CLI
const TOKEN_ADDR = process.argv[2] || process.env.TOKEN_B;

async function fetchAccountInfo(client: any, token: any) {
  if (typeof client.getAccountInfo === 'function') {
    console.log("ℹ️ Using client.getAccountInfo()");
    return client.getAccountInfo(token);
  }
  if (typeof client.accountInfo === 'function') {
    console.log("ℹ️ Using client.accountInfo()");
    return client.accountInfo(token);
  }
  throw new Error("❌ Neither getAccountInfo nor accountInfo is available in client.");
}

async function main() {
  if (!TOKEN_ADDR) {
    throw new Error("❌ No token address provided. Pass as CLI arg or set TOKEN_B in .env");
  }

  const client = KeetaNet.Client.fromNetwork(NETWORK);
  const tokenAccount = KeetaNet.lib.Account.fromPublicKeyString(TOKEN_ADDR);

  console.log(`🔍 Fetching decimals for token: ${TOKEN_ADDR} on ${NETWORK}`);

  try {
    const tokenInfo = await fetchAccountInfo(client, tokenAccount);

    if (!tokenInfo) {
      console.error("❌ No account info returned");
      return;
    }

    console.log("📦 Raw tokenInfo:", tokenInfo);

    if (tokenInfo.info?.metadata) {
      try {
        const metaObj = JSON.parse(
          Buffer.from(tokenInfo.info.metadata, 'base64').toString()
        );
        console.log("📝 Decoded metadata:", metaObj);

        if (typeof metaObj.decimalPlaces === 'number') {
          console.log(`✅ Decimals (from metadata): ${metaObj.decimalPlaces}`);
        } else {
          console.warn("⚠️ Metadata found, but no decimalPlaces field.");
        }
      } catch (e) {
        console.warn("⚠️ Failed to parse metadata:", e);
      }
    } else {
      console.warn("⚠️ No metadata field on token account");
    }
  } catch (err) {
    console.error("❌ Error fetching account info:", err);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
