import 'dotenv/config';
import * as KeetaNet from '@keetanetwork/keetanet-client';

const OPS_SEED = process.env.OPS_SEED!;
const ops = KeetaNet.lib.Account.fromSeed(OPS_SEED, 0);
const opsClient = KeetaNet.UserClient.fromNetwork('test', ops);

console.log("Available methods on opsClient:");
console.log(Object.keys(Object.getPrototypeOf(opsClient)));
