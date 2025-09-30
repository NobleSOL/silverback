// src/bootstrap.ts
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import * as KeetaNet from '@keetanetwork/keetanet-client';

const NETWORK = (process.env.NETWORK || 'test') as 'test' | 'dev' | 'staging' | 'main';

// Tokens (as strings) — generic setup
const BASE_TOKEN =
  process.env.BASE_TOKEN ||
  'keeta_anyiff4v34alvumupagmdyosydeq24lc4def5mrpmmyhx3j6vj2uucckeqn52'; // always KTA
const TOKEN_B =
  process.env.TOKEN_B ||
  'keeta_anchh4m5ukgvnx5jcwe56k3ltgo4x4kppicdjgcaftx4525gdvknf73fotmdo'; // user-defined

// Fee receiver (public only, no seed required)
const FEE_ADDR =
  process.env.FEE_ADDR ||
  'keeta_aabit74nxmqkkivujuonoifslc55sf5flmic6zvctvzcpqp2roefdgu6dcp5zni';

// Liquidity amounts (human-readable)
const BASE_LIQUIDITY_HUMAN = 1; // 1 BASE
const TOKEN_B_LIQUIDITY_HUMAN = 400_000; // 400,000 TokenB

// Base is always 9 decimals
const BASE_DECIMALS = 9;

// Fee rate (0.3%)
const FEE_NUM = 3n;
const FEE_DEN = 1000n;

// --- Strict HEX seed loader ---
function seedFromHexEnv(varName: string): Buffer {
  const raw = (process.env as any)[varName];
  if (!raw) throw new Error(`${varName} missing in .env`);
  if (!/^[0-9A-Fa-f]{64}$/.test(raw.trim())) {
    throw new Error(`${varName} must be 64 hex chars`);
  }
  return Buffer.from(raw.trim(), 'hex');
}

// --- Helper: write/update .env line ---
function writeEnvLine(key: string, value: string) {
  const envPath = path.resolve(process.cwd(), '.env');
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const out =
    existing
      .split(/\r?\n/)
      .filter((l) => !l.startsWith(`${key}=`) && l.trim().length > 0)
      .concat([`${key}=${value}`])
      .join('\n') + '\n';
  fs.writeFileSync(envPath, out, 'utf8');
}

// --- Convert human → atomic ---
function toAtomic(amount: number, decimals: number): bigint {
  return BigInt(Math.round(amount * 10 ** decimals));
}

// --- Fetch decimals for Token B ---
async function getTokenBDecimals(client: any, token: any): Promise<number> {
  const envKey = 'TOKEN_B_DECIMALS';
  const envVal = process.env[envKey];
  if (envVal && /^\d+$/.test(envVal)) {
    console.log(`ℹ️ Using ${envKey} from .env: ${envVal}`);
    return parseInt(envVal, 10);
  }

  try {
    const tokenInfo = await client.getAccountInfo(token);
    let decimals = 0;

    if (tokenInfo?.info?.metadata) {
      try {
        const metaObj = JSON.parse(
          Buffer.from(tokenInfo.info.metadata, 'base64').toString()
        );
        if (metaObj.decimalPlaces !== undefined) {
          const parsed = Number(metaObj.decimalPlaces);
          if (!isNaN(parsed)) {
            decimals = parsed;
            console.log(`✅ TokenB decimals fetched from metadata: ${decimals}`);
          } else {
            console.warn(`⚠️ decimalPlaces present but not a valid number: ${metaObj.decimalPlaces}`);
          }
        } else {
          console.warn(`⚠️ Metadata found, but no decimalPlaces field.`);
        }
      } catch (e) {
        console.warn(`⚠️ Failed to parse TokenB metadata:`, e);
      }
    } else {
      console.warn(`⚠️ No metadata field on TokenB account`);
    }

    if (decimals === 0) {
      throw new Error(`❌ TokenB decimals came back as 0. Please set ${envKey} in your .env file.`);
    }

    writeEnvLine(envKey, decimals.toString());
    return decimals;
  } catch (err) {
    console.warn(`⚠️ Could not fetch decimals for TokenB: ${err}`);
    throw new Error(`❌ TokenB decimals could not be fetched. Please set ${envKey} in your .env file.`);
  }
}

async function main() {
  // 1) Load accounts
  const treasury = KeetaNet.lib.Account.fromSeed(seedFromHexEnv('TREASURY_SEED'), 0);
  const ops = KeetaNet.lib.Account.fromSeed(seedFromHexEnv('OPS_SEED'), 0);

  const treasuryAddr = treasury.publicKeyString.get();
  const opsAddr = ops.publicKeyString.get();
  console.log('Treasury account:', treasuryAddr);
  console.log('Ops account:', opsAddr);
  console.log('Fee receiver (public only):', FEE_ADDR);

  const treasuryClient = KeetaNet.UserClient.fromNetwork(NETWORK, treasury);

  // Wrap tokens
  const baseTokenAccount = KeetaNet.lib.Account.fromPublicKeyString(BASE_TOKEN);
  const tokenBAccount = KeetaNet.lib.Account.fromPublicKeyString(TOKEN_B);

  // --- Get decimals ---
  const tokenBDecimals = await getTokenBDecimals(treasuryClient, tokenBAccount);

  // Convert human → atomic
  const BASE_LIQUIDITY = toAtomic(BASE_LIQUIDITY_HUMAN, BASE_DECIMALS);
  const TOKEN_B_LIQUIDITY = toAtomic(TOKEN_B_LIQUIDITY_HUMAN, tokenBDecimals);

  // 2) Storage account (create if missing)
  let marketId = process.env.MARKET_ID?.trim();
  if (!marketId) {
    console.log(`⚠️ No MARKET_ID in .env, creating storage account for BASE ↔ TOKEN_B…`);

    const builder = treasuryClient.initBuilder();

    const pendingStorage = builder.generateIdentifier(
      KeetaNet.lib.Account.AccountKeyAlgorithm.STORAGE
    );
    await builder.computeBlocks();
    const storageAccount = pendingStorage.account;
    marketId = storageAccount.publicKeyString.toString();

    console.log('storageAccount.publicKey =', marketId);

    // ✅ Include fee config in metadata
    builder.setInfo(
      {
        name: 'SILVERBACK_POOL',
        description: 'LiquidityPool_BASE_TOKENB',
        metadata: JSON.stringify({
          feeToken: BASE_TOKEN,
          feeReceiver: FEE_ADDR,
          feeRate: `${FEE_NUM}/${FEE_DEN}`,
        }),
        defaultPermission: new KeetaNet.lib.Permissions([
          'ACCESS',
          'STORAGE_CAN_HOLD',
          'STORAGE_DEPOSIT',
        ]),
      },
      { account: storageAccount }
    );

    // ✅ Give Ops delegated trading ability
    builder.updatePermissions(
      ops,
      new KeetaNet.lib.Permissions(['SEND_ON_BEHALF']),
      undefined,
      undefined,
      { account: storageAccount }
    );

    await treasuryClient.publishBuilder(builder);

    console.log(`✅ Created storage account with public permissions: ${marketId}`);
    writeEnvLine('MARKET_ID', marketId);
  } else {
    console.log(`ℹ️ Using existing MARKET_ID from .env: ${marketId}`);
  }

  const marketAccount = KeetaNet.lib.Account.fromPublicKeyString(marketId);

  // 3) Fund liquidity
  try {
    console.log(
      `➡️ Adding liquidity: ${BASE_LIQUIDITY_HUMAN} BASE + ${TOKEN_B_LIQUIDITY_HUMAN} TokenB → ${marketId}`
    );

    const builder = treasuryClient.initBuilder();
    builder.send(marketAccount, BASE_LIQUIDITY, baseTokenAccount);
    builder.send(marketAccount, TOKEN_B_LIQUIDITY, tokenBAccount);

    await treasuryClient.publishBuilder(builder);

    console.log(`✅ Liquidity added successfully`);
  } catch (e: any) {
    console.warn('⚠️ Liquidity add failed:', e?.message ?? e);
  }

  console.log(`🚀 Silverback DEX storage account ready: ${marketId}`);
  console.log(`🔗 Explorer (Market): https://explorer.test.keeta.com/account/${marketId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

