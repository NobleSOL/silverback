// functions/removeLiquidity.js
import { withCors } from "./cors.js";
import {
  createClient,
  resolveOrDiscoverPool,
  loadTokenDetails,
  toRawAmount,
  formatAmount,
  calculateWithdrawal,
} from "./utils/keeta.js";

function parseBody(body) {
  if (!body) return {};
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function bigintReplacer(_k, v) {
  return typeof v === "bigint" ? v.toString() : v;
}

export const handler = withCors(async (event) => {
  if (event.httpMethod?.toUpperCase() === "OPTIONS") {
    return { statusCode: 204, body: "" };
  }

  try {
    const {
      seed,
      accountIndex = 0,
      poolAccount,
      marketId,
      tokenAddresses,
      tokenA,          // optional symbol hint
      tokenB,          // optional symbol hint
      tokenAAddress,   // optional override
      tokenBAddress,   // optional override
      lpAmount,        // human-readable LP amount
    } = parseBody(event.body);

    if (!seed) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing seed" }) };
    }
    if (!lpAmount) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing LP amount" }) };
    }

    const client = await createClient({ seed, accountIndex });

    // 🔑 Dynamically resolve pool & LP from inputs
    const { poolRef, lpTokenRef, tokenARef, tokenBRef, feeBps } =
      await resolveOrDiscoverPool(client, {
        poolAccount,
        marketId,
        tokenAddresses,
        tokenAAddress,
        tokenBAddress,
        tokenASymbol: tokenA,
        tokenBSymbol: tokenB,
      });

    // Load token + LP metadata
    const [infoA, infoB, lpInfo] = await Promise.all([
      loadTokenDetails(client, tokenARef),
      loadTokenDetails(client, tokenBRef),
      loadTokenDetails(client, lpTokenRef),
    ]);

    // Get reserves
    const balances = await client.client.getAllBalances(poolRef);
    const reserveMap = new Map();
    for (const { token, balance } of balances) {
      reserveMap.set(token.publicKeyString.get(), balance);
    }
    const reserveA = reserveMap.get(infoA.address) || 0n;
    const reserveB = reserveMap.get(infoB.address) || 0n;
    const lpSupply = await client.client.getTokenSupply(lpTokenRef);

    // Convert LP amount into raw units
    const rawLp = toRawAmount(String(lpAmount), lpInfo.decimals);

    // Simulate withdrawal outcome
    const { amountA, amountB, share } = calculateWithdrawal(
      rawLp,
      reserveA,
      reserveB,
      lpSupply
    );

    const payload = {
      message: "Remove liquidity prepared (not broadcast).",
      pool: { address: poolRef.publicKeyString.get(), feeBps },
      withdrawals: {
        tokenA: {
          symbol: infoA.symbol,
          amountRaw: amountA.toString(),
          amountFormatted: formatAmount(amountA, infoA.decimals),
        },
        tokenB: {
          symbol: infoB.symbol,
          amountRaw: amountB.toString(),
          amountFormatted: formatAmount(amountB, infoB.decimals),
        },
      },
      lp: {
        symbol: lpInfo.symbol,
        amountRaw: rawLp.toString(),
        amountFormatted: formatAmount(rawLp, lpInfo.decimals),
        share,
      },
    };

    return { statusCode: 200, body: JSON.stringify(payload, bigintReplacer) };
  } catch (error) {
    console.error("removeLiquidity error", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error?.message || "Remove liquidity failed",
      }),
    };
  }
});

