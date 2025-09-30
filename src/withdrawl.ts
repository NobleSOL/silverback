// src/withdrawl.ts
import 'dotenv/config';
import * as KeetaNet from '@keetanetwork/keetanet-client';

const NETWORK = (process.env.NETWORK || 'test') as
  | 'test'
  | 'dev'
  | 'staging'
  | 'main';

// --- Strict HEX seed loader ---
function seedFromHexEnv(varName: string): Buffer {
  const raw = (process.env as any)[varName];
  if (!raw) throw new Error(`${varName} missing in .env`);
  if (!/^[0-9A-Fa-f]{64}$/.test(raw.trim())) {
    throw new Error(`${varName} must be 64 hex chars`);
  }
  return Buffer.from(raw.trim(), 'hex');
}

async function main() {
  // Load treasury (withdraw target)
  const treasury = KeetaNet.lib.Account.fromSeed(seedFromHexEnv('TREASURY_SEED'), 0);
  const treasuryAddr = treasury.publicKeyString.get();
  console.log('Treasury account:', treasuryAddr);

  const treasuryClient = KeetaNet.UserClient.fromNetwork(NETWORK, treasury);

  // Market ID to drain
  const marketId = process.env.MARKET_ID?.trim();
  if (!marketId) throw new Error('MARKET_ID missing from .env');

  const marketAccount = KeetaNet.lib.Account.fromPublicKeyString(marketId);

  console.log(`⚠️ Draining ALL liquidity from pool: ${marketId}`);

  // Fetch all balances in pool
  const balances = await treasuryClient.allBalances({ account: marketAccount });
  console.log('Pool balances:', balances);

  if (balances.length === 0) {
    console.log('✅ Pool is already empty');
    return;
  }

  // Create withdrawal builder
  const builder = treasuryClient.initBuilder();

  for (const b of balances) {
    const tokenAccount = b.token; // already an Account
    const tokenId = tokenAccount.publicKeyString.get();
    const amount = BigInt(b.balance ?? b.amount ?? 0);

    if (amount > 0n) {
      console.log(`➡️ Withdrawing ${amount} of ${tokenId} → ${treasuryAddr}`);
      builder.send(treasury, amount, tokenAccount, undefined, { account: marketAccount });
    }
  }

  await treasuryClient.publishBuilder(builder);

  console.log('✅ Pool drained completely.');
  console.log(`🔗 Explorer (Market): https://explorer.test.keeta.com/account/${marketId}`);
  console.log(`🔗 Explorer (Treasury): https://explorer.test.keeta.com/account/${treasuryAddr}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
