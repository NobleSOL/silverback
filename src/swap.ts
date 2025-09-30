import 'dotenv/config';
import * as KeetaNet from '@keetanetwork/keetanet-client';

const NETWORK = (process.env.NETWORK || 'test') as 'test' | 'dev' | 'staging' | 'main';

// Tokens
const BASE_TOKEN = process.env.BASE_TOKEN || 'keeta_anyiff4v34alvumupagmdyosydeq24lc4def5mrpmmyhx3j6vj2uucckeqn52';
const TOKEN_B = process.env.TOKEN_B || 'keeta_anchh4m5ukgvnx5jcwe56k3ltgo4x4kppicdjgcaftx4525gdvknf73fotmdo';

// Fee receiver (public address only)
const FEE_ADDR = process.env.FEE_ADDR || 'keeta_aabit74nxmqkkivujuonoifslc55sf5flmic6zvctvzcpqp2roefdgu6dcp5zni';

// CLI overrides
const cliDirection = process.argv[2];
const cliAmount = process.argv[3];

const DIRECTION = cliDirection || process.env.DIRECTION || 'BASE_TO_TOKENB';
const SWAP_AMOUNT_HUMAN = cliAmount ? Number(cliAmount) : Number(process.env.SWAP_AMOUNT_HUMAN || 0.01);

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

// --- Convert human → atomic ---
function toAtomic(amount: number, decimals: number): bigint {
  return BigInt(Math.round(amount * 10 ** decimals));
}

// --- Fetch decimals from metadata ---
async function getDecimals(client: any, token: any, envKey: string): Promise<number> {
  const override = process.env[envKey];
  if (override) return Number(override);

  try {
    const tokenInfo = await client.getAccountInfo(token);
    if (tokenInfo?.info?.metadata) {
      const metaObj = JSON.parse(Buffer.from(tokenInfo.info.metadata, 'base64').toString());
      if (metaObj.decimalPlaces !== undefined) {
        return Number(metaObj.decimalPlaces);
      }
    }
  } catch (err) {
    console.warn(`⚠️ Could not fetch decimals for ${envKey}`, err);
  }
  return 0;
}

async function main() {
  // Load Ops
  const ops = KeetaNet.lib.Account.fromSeed(seedFromHexEnv('OPS_SEED'), 0);

  const opsAddr = ops.publicKeyString.get();
  console.log('Ops account:', opsAddr);
  console.log('Fee receiver (public only):', FEE_ADDR);

  const opsClient = KeetaNet.UserClient.fromNetwork(NETWORK, ops);

  // Market ID
  const marketId = process.env.MARKET_ID?.trim();
  if (!marketId) throw new Error('MARKET_ID missing from .env');
  const marketAccount = KeetaNet.lib.Account.fromPublicKeyString(marketId);

  // Token Accounts
  const baseToken = KeetaNet.lib.Account.fromPublicKeyString(BASE_TOKEN);
  const tokenB = KeetaNet.lib.Account.fromPublicKeyString(TOKEN_B);
  const feeAccount = KeetaNet.lib.Account.fromPublicKeyString(FEE_ADDR);

  // Fetch decimals
  const baseDecimals = Number(process.env.BASE_DECIMALS || 9); // BASE always 9
  const tokenBDecimals = await getDecimals(opsClient, tokenB, 'TOKEN_B_DECIMALS');

  // Scale amount
  const amountAtomic =
    DIRECTION === 'BASE_TO_TOKENB'
      ? toAtomic(SWAP_AMOUNT_HUMAN, baseDecimals)
      : toAtomic(SWAP_AMOUNT_HUMAN, tokenBDecimals);

  if (amountAtomic === 0n) throw new Error(`Swap amount rounded to 0.`);

  // Get pool balances
  const rawBalances = await opsClient.allBalances({ account: marketAccount });
  const poolBalances = rawBalances.map((b) => ({
    token: b.token.publicKeyString?.toString() ?? b.token.toString(),
    balance: BigInt(b.balance ?? 0n),
  }));

  const baseBalance = poolBalances.find((b) => b.token === BASE_TOKEN)?.balance ?? 0n;
  const tokenBBalance = poolBalances.find((b) => b.token === TOKEN_B)?.balance ?? 0n;

  if (baseBalance === 0n || tokenBBalance === 0n) throw new Error('Pool has no liquidity!');

  let amountOut: bigint;
  let fee: bigint;

  if (DIRECTION === 'BASE_TO_TOKENB') {
    // BASE → TokenB
    fee = (amountAtomic * FEE_NUM) / FEE_DEN;
    const amountInAfterFee = amountAtomic - fee;

    const newBaseBalance = baseBalance + amountInAfterFee;
    const newTokenBBalance = (baseBalance * tokenBBalance) / newBaseBalance;
    amountOut = tokenBBalance - newTokenBBalance;

    console.log(
      `➡️ Swapping ${SWAP_AMOUNT_HUMAN} BASE for ~${Number(amountOut) / 10 ** tokenBDecimals} TokenB (fee ${Number(fee) / 10 ** baseDecimals} BASE)`
    );
  } else {
    // TokenB → BASE
    const newTokenBBalance = tokenBBalance + amountAtomic;
    const newBaseBalance = (baseBalance * tokenBBalance) / newTokenBBalance;
    const amountOutRaw = baseBalance - newBaseBalance;

    fee = (amountOutRaw * FEE_NUM) / FEE_DEN;
    amountOut = amountOutRaw - fee;

    console.log(
      `➡️ Swapping ${SWAP_AMOUNT_HUMAN} TokenB for ~${Number(amountOut) / 10 ** baseDecimals} BASE (fee ${Number(fee) / 10 ** baseDecimals} BASE)`
    );
  }

  // Build transaction
  const builder = opsClient.initBuilder();

  if (DIRECTION === 'BASE_TO_TOKENB') {
    builder.send(marketAccount, amountAtomic, baseToken);
    if (fee > 0n) builder.send(feeAccount, fee, baseToken);
    builder.send(ops, amountOut, tokenB, undefined, { account: marketAccount });
  } else {
    builder.send(marketAccount, amountAtomic, tokenB);
    if (fee > 0n) builder.send(feeAccount, fee, baseToken);
    builder.send(ops, amountOut, baseToken, undefined, { account: marketAccount });
  }

  await opsClient.publishBuilder(builder);

  console.log('✅ Swap executed successfully!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

