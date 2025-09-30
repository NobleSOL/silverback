import 'dotenv/config';
import * as KeetaNet from '@keetanetwork/keetanet-client';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

const NETWORK = (process.env.NETWORK || 'test') as 'test' | 'main' | 'staging' | 'dev';
const TREASURY_SEED = process.env.TREASURY_SEED!;
const OPS_SEED = process.env.OPS_SEED!;

if (!TREASURY_SEED || !OPS_SEED) {
  throw new Error('Missing TREASURY_SEED or OPS_SEED in .env');
}

async function main() {
  const treasury = KeetaNet.lib.Account.fromSeed(TREASURY_SEED, 0);
  const ops = KeetaNet.lib.Account.fromSeed(OPS_SEED, 0);

  console.log('Treasury account:', treasury.publicKeyString?.get?.());
  console.log('Ops account:', ops.publicKeyString?.get?.());

  const treasuryClient = KeetaNet.UserClient.fromNetwork(NETWORK, treasury);
  const opsClient = KeetaNet.UserClient.fromNetwork(NETWORK, ops);

  // Use .env DEX_ID if set, otherwise generate a new one
  let dexId: string | undefined = process.env.DEX_ID;
  if (!dexId) {
    dexId = "silverback-dex-" + randomUUID();

    const createBlock = treasuryClient.userBuilder()
      .block()
      .addAccount(treasury)
      .addOperation(
        new KeetaNet.Referenced.BlockOperationCREATE_IDENTIFIER({
          identifier: dexId,
          createArguments: { type: 'SIMPLE' }
        })
      )
      .seal();

    const staple = await treasuryClient.publish(createBlock);
    console.log('✅ Created DEX identifier:', dexId, 'staple hash:', staple.hash);

    // --- Write back into .env ---
    const envPath = path.resolve(process.cwd(), '.env');
    let envContent = '';
    try {
      envContent = fs.readFileSync(envPath, 'utf8');
    } catch {
      console.warn('⚠️ No .env found, creating new one');
    }

    const lines = envContent.split(/\r?\n/).filter(Boolean);
    const newLines = lines.filter(l => !l.startsWith('DEX_ID='));
    newLines.push(`DEX_ID=${dexId}`);
    fs.writeFileSync(envPath, newLines.join('\n'), 'utf8');
    console.log(`📝 Wrote DEX_ID=${dexId} into .env`);
  } else {
    console.log('ℹ️ Using existing DEX identifier from .env:', dexId);
  }

  // Delegate ADMIN + OWNER to ops account
  try {
    await treasuryClient.updatePermissions(
      ops,
      { base: { ADMIN: true, OWNER: true } },
      KeetaNet.lib.Account.fromPublicKeyString(dexId!)
    );
    console.log('✅ Delegated ADMIN + OWNER to ops account');
  } catch (e: any) {
    console.log('⚠️ updatePermissions may already be applied:', e.message || e);
  }

  // Brand the DEX identifier
  try {
    const info = {
      name: 'Silverback DEX',
      description: 'The native AMM DEX for trading tokens against KTA',
      tags: ['silverback', 'dex', 'amm'],
      metadata: JSON.stringify({ silverback: true })
    };
    const branded = await opsClient.setInfo(info);
    console.log('✅ Applied Silverback branding, staple hash:', branded.hash);
  } catch (e: any) {
    console.log('⚠️ Branding step skipped/failed:', e.message || e);
  }

  console.log('Silverback DEX ready:', dexId);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
