import 'dotenv/config';
import * as KeetaNet from '@keetanetwork/keetanet-client';

const NETWORK = (process.env.NETWORK || 'test') as 'test'|'main'|'staging'|'dev';
const TREASURY_SEED = process.env.TREASURY_SEED!;
const OPS_SEED = process.env.OPS_SEED!;

if (!TREASURY_SEED || !OPS_SEED) {
  throw new Error('Missing TREASURY_SEED or OPS_SEED in .env');
}

async function main() {
  // Accounts & clients
  const treasury = KeetaNet.lib.Account.fromSeed(TREASURY_SEED, 0);
  const ops = KeetaNet.lib.Account.fromSeed(OPS_SEED, 0);

  const treasuryClient = KeetaNet.UserClient.fromNetwork(NETWORK, treasury);
  const opsClient = KeetaNet.UserClient.fromNetwork(NETWORK, ops);

  console.log('Treasury account:', treasury.identifier);
  console.log('Ops account:', ops.identifier);

  // ----------------------------------------------------------
  // 1. Check if Silverback DEX identifier already exists
  // ----------------------------------------------------------
  let dexId: string | undefined;

  try {
    // If you already know the DEX id, you can keep it in .env (DEX_ID)
    if (process.env.DEX_ID) {
      dexId = process.env.DEX_ID;
      console.log('DEX_ID from env:', dexId);
    } else {
      // Otherwise, try to fetch account info by querying ops client’s known identifiers.
      // NOTE: adjust this if SDK exposes a direct "getInfoByName" or "listIdentifiers".
      // Here we assume you can call getInfo(accountId) and check the name.
      const info = await opsClient.getInfo();
      if (info?.name === 'Silverback DEX') {
        dexId = ops.identifier; // already branded as Silverback
      }
    }
  } catch (e) {
    console.log('No existing Silverback DEX found, will create fresh');
  }

  // ----------------------------------------------------------
  // 2. Create if missing
  // ----------------------------------------------------------
  if (!dexId) {
    dexId = KeetaNet.lib.Identifier.generate();

    const createBlock = treasuryClient.initBuilder()
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
  } else {
    console.log('ℹ️ Using existing DEX identifier:', dexId);
  }

  // ----------------------------------------------------------
  // 3. Delegate ADMIN + OWNER to ops account
  // ----------------------------------------------------------
  try {
    await treasuryClient.updatePermissions(
      ops,
      { base: { ADMIN: true, OWNER: true } },
      KeetaNet.lib.Account.fromPublicKeyString(dexId)
    );
    console.log('✅ Delegated ADMIN + OWNER to ops account');
  } catch (e: any) {
    console.log('⚠️ updatePermissions may have already been applied:', e.message || e);
  }

  // ----------------------------------------------------------
  // 4. Brand the DEX identifier
  // ----------------------------------------------------------
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

  console.log('Silverback DEX is ready on network:', NETWORK, 'identifier:', dexId);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
