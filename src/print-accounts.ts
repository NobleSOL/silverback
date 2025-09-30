
import 'dotenv/config';
import * as KeetaNet from '@keetanetwork/keetanet-client';

const TREASURY_SEED = process.env.TREASURY_SEED!;
const OPS_SEED = process.env.OPS_SEED!;

if (!TREASURY_SEED || !OPS_SEED) {
  throw new Error('Missing TREASURY_SEED or OPS_SEED in .env');
}

function showAccount(label: string, seed: string) {
  const acct = KeetaNet.lib.Account.fromSeed(seed, 0);
  const pubKey = acct.publicKeyString?.get?.() || acct.publicKeyString?.toString?.();
  console.log(`\n=== ${label} ===`);
  console.log("Public Key:", pubKey);
}

showAccount("Treasury", TREASURY_SEED);
showAccount("Ops", OPS_SEED);
