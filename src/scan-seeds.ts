import 'dotenv/config';
import * as KeetaNet from '@keetanetwork/keetanet-client';

const FUNDED_TREASURY = "keeta_aab4hgm7kyiwgtra7sptrdir3i6qz46xyepo3rdj7bpyxfh43atr3plpqzlxjwi";
const FUNDED_OPS = "keeta_aabdq4smd5cf2dcvbhvyc3shdypm2nxafmc3plzkuuflyif6zi4tslcoh7ekb7i";

function scanSeed(label: string, base64Seed: string | undefined, funded: string) {
  if (!base64Seed) {
    console.log(`⚠️ ${label} seed missing in .env`);
    return;
  }

  const raw = Buffer.from(base64Seed, "base64");
  const seed = raw.subarray(0, 32);

  console.log(`\n=== ${label} ===`);
  console.log(`Raw length: ${raw.length}, Truncated length: ${seed.length}`);
  console.log(`Looking for funded key: ${funded}\n`);

  for (let i = 0; i < 20; i++) {
    try {
      const acc = KeetaNet.lib.Account.fromSeed(seed, i);
      const pub = acc.publicKeyString.get();
      const marker = pub === funded ? "✅ MATCH FUNDED" : "";
      console.log(`Index ${i}: ${pub} ${marker}`);
    } catch (e: any) {
      console.error(`Index ${i} failed:`, e.message || e);
    }
  }
}

function main() {
  scanSeed("Treasury", process.env.TREASURY_SEED, FUNDED_TREASURY);
  scanSeed("Ops", process.env.OPS_SEED, FUNDED_OPS);
}

main();
