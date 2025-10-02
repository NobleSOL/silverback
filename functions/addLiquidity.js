// functions/addLiquidity.js
import { withCors } from "./cors.js";
import {
  createClient,
  resolveOrDiscoverPool,
  loadTokenDetails,
  toRawAmount,
  formatAmount,
  calculateLiquidityMint,
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
      tokenA,          // symbol hint (optional)
      tokenB,          // symbol hint (optional)
      tokenAAddress,   // optional override
      tokenBAddress,   // optional override
      amountA,         // human string
      amountB,         // human string
    } = parseBody(event.body);

    if (!seed) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing seed" }) };
    }
    if (!amountA || !amountB) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing liquidity amounts" }) };
    }

    const client = await createClient({ seed, accountIndex });

    // 🔑 dynamically resolve or discover pool
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

    // fetch token + LP metadata (with decimals, symbol, etc.)
    const [infoA, infoB, lpInfo] = await Promise.all([
      loadTokenDetails(client, tokenARef),
      loadTokenDetails(client, tokenBRef),
      loadTokenDetails(client, lpTokenRef),
    ]);

    // get reserves
    const balances = await client.client.getAllBalances(poolRef);
    const reserveMap = new Map();
    for (const { token, balance } of balances) {
      reserveMap.set(token.publicKeyString.get(), balance);
    }
    const reserveA = reserveMap.get(infoA.address) || 0n;
    const reserveB = reserveMap.get(infoB.address) || 0n;
    const lpSupply = await client.client.getTokenSupply(lpTokenRef);

    // normalize inputs
    const rawA = toRawAmount(String(amountA), infoA.decimals);
    const rawB = toRawAmount(String(amountB), infoB.decimals);

    // simulate mint outcome
    const { minted, share } = calculateLiquidityMint(rawA, rawB, reserveA, reserveB, lpSupply);

    const payload = {
      message: "Add liquidity prepared (not broadcast).",
      pool: {
        address: poolRef.publicKeyString.get(),
        feeBps,
      },
      minted: {
        raw: minted.toString(),
        formatted: formatAmount(minted, lpInfo.decimals),
        symbol: lpInfo.symbol,
        share,
      },
      inputs: {
        tokenA: {
          symbol: infoA.symbol,
          amountRaw: rawA.toString(),
          amountFormatted: formatAmount(rawA, infoA.decimals),
        },
        tokenB: {
          symbol: infoB.symbol,
          amountRaw: rawB.toString(),
          amountFormatted: formatAmount(rawB, infoB.decimals),
        },
      },
    };

    return { statusCode: 200, body: JSON.stringify(payload, bigintReplacer) };
  } catch (error) {
    console.error("addLiquidity error", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error?.message || "Add liquidity failed",
      }),
    };
  }
});
