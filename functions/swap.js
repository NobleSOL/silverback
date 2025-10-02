// functions/swap.js
import { withCors } from "./cors.js";
import {
  createClient,
  resolveOrDiscoverPool,
  loadTokenDetails,
  toRawAmount,
  formatAmount,
  calculateSwapQuote,
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
      tokenIn,          // optional: contract address for tokenIn
      tokenInSymbol,    // optional: symbol hint for tokenIn
      tokenOut,         // optional: contract address for tokenOut
      tokenOutSymbol,   // optional: symbol hint for tokenOut
      amountIn,         // raw or human? we’ll interpret below
      amountInHuman,    // preferred human field if provided
      slippageBps = 50, // for minOut calc in UI
    } = parseBody(event.body);

    if (!seed) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing seed" }) };
    }

    const client = await createClient({ seed, accountIndex });

    // Discover pool entry + canonical token accounts
    const { poolRef, tokenARef, tokenBRef, feeBps } = await resolveOrDiscoverPool(client, {
      poolAccount,
      marketId,
      tokenAddresses,
      tokenAAddress: tokenIn,
      tokenBAddress: tokenOut,
      tokenASymbol: tokenInSymbol,
      tokenBSymbol: tokenOutSymbol,
    });

    // Resolve token details (with decimals/symbols)
    const [tokenAInfo, tokenBInfo] = await Promise.all([
      loadTokenDetails(client, tokenARef),
      loadTokenDetails(client, tokenBRef),
    ]);

    // Identify which side is in/out by matching symbol/address hints
    const match = (info, addr, sym) =>
      (addr && info.address === addr) || (sym && info.symbol?.toUpperCase() === sym?.toUpperCase());

    const inInfo = match(tokenAInfo, tokenIn, tokenInSymbol) ? tokenAInfo : tokenBInfo;
    const outInfo = inInfo === tokenAInfo ? tokenBInfo : tokenAInfo;

    const balances = await client.client.getAllBalances(poolRef);
    const reserveMap = new Map();
    for (const { token, balance } of balances) {
      reserveMap.set(token.publicKeyString.get(), balance);
    }

    const reserveIn = reserveMap.get(inInfo.address) || 0n;
    const reserveOut = reserveMap.get(outInfo.address) || 0n;

    // Parse input amount
    const rawIn = (() => {
      if (amountInHuman != null) return toRawAmount(String(amountInHuman), inInfo.decimals);
      if (amountIn != null) {
        // if caller already sent raw, accept bigint-ish
        try {
          return BigInt(amountIn);
        } catch {
          return toRawAmount(String(amountIn), inInfo.decimals);
        }
      }
      return 0n;
    })();

    const { amountOut, feePaid, priceImpact } = calculateSwapQuote(
      rawIn,
      reserveIn,
      reserveOut,
      typeof feeBps === "number" ? feeBps : 30
    );

    const minOutRaw = (amountOut * BigInt(10_000 - Number(slippageBps))) / 10_000n;

    const payload = {
      message: "Swap prepared (not broadcast).",
      priceImpact: Number.isFinite(priceImpact) ? (priceImpact * 100).toFixed(4) : "0.0000",
      tokens: {
        from: {
          symbol: inInfo.symbol,
          amountRaw: rawIn.toString(),
          amountFormatted: formatAmount(rawIn, inInfo.decimals),
          feePaidRaw: feePaid.toString(),
          feePaidFormatted: formatAmount(feePaid, inInfo.decimals),
        },
        to: {
          symbol: outInfo.symbol,
          expectedRaw: amountOut.toString(),
          amountFormatted: formatAmount(amountOut, outInfo.decimals),
          minimumFormatted: formatAmount(minOutRaw, outInfo.decimals),
        },
      },
      pool: {
        address: poolRef.publicKeyString.get(),
        feeBps: typeof feeBps === "number" ? feeBps : 30,
      },
    };

    return { statusCode: 200, body: JSON.stringify(payload, bigintReplacer) };
  } catch (error) {
    console.error("swap error", error);
    return { statusCode: 500, body: JSON.stringify({ error: error?.message || "Swap failed" }) };
  }
});
