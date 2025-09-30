import 'dotenv/config';
import * as KeetaNet from '@keetanetwork/keetanet-client';

const TREASURY_SEED = process.env.TREASURY_SEED!;
const OPS_SEED = process.env.OPS_SEED!;

if (!TREASURY_SEED || !OPS_SEED) {
  throw new Error('Missing TREASURY_SEED or OPS_SEED');
}

const treasury = KeetaNet.lib.Account.fromSeed(TREASURY_SEED, 0);
const ops = KeetaNet.lib.Account.fromSeed(OPS_SEED, 0);

console.log("Treasury account object:", treasury);
console.log("Ops account object:", ops);
