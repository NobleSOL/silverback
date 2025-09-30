/* functions/swap.js */
/* eslint-disable no-console */
import * as KeetaNet from "@keetanetwork/keetanet-client";
import { withCors } from "./cors.js";
import {
  EXECUTE_TRANSACTIONS,
  calculateSwapQuote,
  createClient,
  formatAmount,
  loadPoolContext,
} from "./utils/keeta.js";

function parseRequest(event) {
  if (!event?.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function normalizeString(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function parseAmountRaw(value) {
  if (value === undefined || value === null) return 0n;
  const normalized = normalizeString(String(value));
  if (!normalized) return 0n;
  try {
    return BigInt(normalized);
  } catch {
    throw new Error("Swap amount must be a stringified integer representing the raw token amount");
  }
}

function resolveToken(context, address, symbol) {
  if (!context?.tokens?.length) return null;
  const normalizedAddress = normalizeString(address);
  const normalizedSymbol = normalizeString(symbol).toUpperCase();
  for (const token of context.tokens) {
    if (!token) continue;
    if (normalizedAddress && normalizeString(token.address) === normalizedAddress) {
      return token;
    }
    if (normalizedSymbol && token.symbol?.toUpperCase?.() === normalizedSymbol) {
      return token;
    }
  }
  return null;
}

// 🔑 New: actually build + sign + submit tx
async function executeSwap(client, context, params) {
  const poolAccount = KeetaNet.lib.Account.toAccount(context.pool.address);
  const tokenInAccount = KeetaNet.lib.Account.toAccount(params.tokenIn.address);
  const tokenOutAccount = KeetaNet.lib.Account.toAccount(params.tokenOut.address);

  const builder = client.initBuilder();
  builder.send(poolAccount, params.amountInRaw, tokenInAccount);
  builder.receive(poolAccount, params.amountOutRaw, tokenOutAccount, true);

  const blocks = await client.computeBuilderBlocks(builder);

  let txHash = null;
  if (EXECUTE_TRANSACTIONS) {
    const published = await client.publishBuilder(builder);
    const submitted = await client.submitBuilder(builder);
    txHash = submitted?.transactionHash || null;
    return { blocks, published, txHash };
  }

  return { blocks };
}

async function swap(event) {
  if (event.httpMethod && event.httpMethod.toUpperCase() === "OPTIONS") {
    return { statusCode: 204, body: "" };
  }

  let client;
  try {
    const payload = parseRequest(event);
    const {
      seed,
      tokenIn,
      tokenOut,
      amountIn,
      accountIndex = 0,
      poolId,
      poolAccount,
      tokenAddresses = {},
      tokenInSymbol,
      tokenOutSymbol,
    } = payload;

    if (!seed) throw new Error("A signer seed is required to execute a swap");
    if (!tokenIn || !tokenOut) throw new Error("Both token addresses are required");

    const amountInRaw = parseAmountRaw(amountIn);
    if (amountInRaw <= 0n) throw new Error("Swap amount must be greater than zero");

    const poolOverride = normalizeString(poolId || poolAccount);

    client = await createClient({ seed, accountIndex });
    const context = await loadPoolContext(client, {
      poolAccount: poolOverride || undefined,
      tokenAddresses: { ...tokenAddresses },
    });

    const tokenInDetails = resolveToken(context, tokenIn, tokenInSymbol);
    const tokenOutDetails = resolveToken(context, tokenOut, tokenOutSymbol);

    if (!tokenInDetails || !tokenOutDetails) {
      throw new Error("Selected pool does not support the provided token pair");
    }
    if (tokenInDetails.requiresConfiguration || tokenOutDetails.requiresConfiguration) {
      throw new Error("Configure token contract addresses before swapping");
    }

    const reserveIn = BigInt(tokenInDetails.reserveRaw || "0");
    const reserveOut = BigInt(tokenOutDetails.reserveRaw || "0");

    const quote = calculateSwapQuote(amountInRaw, reserveIn, reserveOut, context.pool.feeBps);
    if (quote.amountOut <= 0n) {
      throw new Error("Swap amount too small for current pool reserves");
    }

    const priceImpactPercent = Number.isFinite(quote.priceImpact)
      ? Number((quote.priceImpact * 100).toFixed(4))
      : 0;

    let execution = {};
    if (EXECUTE_TRANSACTIONS) {
      try {
        execution = await executeSwap(client, context, {
          amountInRaw,
          amountOutRaw: quote.amountOut,
          tokenIn: tokenInDetails,
          tokenOut: tokenOutDetails,
        });
      } catch (execError) {
        execution = { error: execError.message };
      }
    }

    const message = execution.error
      ? `Swap prepared but broadcast failed: ${execution.error}`
      : EXECUTE_TRANSACTIONS
      ? execution.txHash
        ? `Swap submitted: ${execution.txHash}`
        : "Swap prepared. Transaction broadcast attempted."
      : "Swap prepared. Set KEETA_EXECUTE_TRANSACTIONS=1 to broadcast automatically.";

    const response = {
      pool: context.pool,
      tokens: {
        from: {
          symbol: tokenInDetails.symbol,
          address: tokenInDetails.address,
          amountRaw: amountInRaw.toString(),
          amountFormatted: formatAmount(amountInRaw, tokenInDetails.decimals || 0),
          feePaidRaw: quote.feePaid.toString(),
          feePaidFormatted: formatAmount(quote.feePaid, tokenInDetails.decimals || 0),
        },
        to: {
          symbol: tokenOutDetails.symbol,
          address: tokenOutDetails.address,
          amountRaw: quote.amountOut.toString(),
          amountFormatted: formatAmount(quote.amountOut, tokenOutDetails.decimals || 0),
          expectedRaw: quote.amountOut.toString(),
        },
      },
      priceImpact: priceImpactPercent,
      execution: {
        attempted: EXECUTE_TRANSACTIONS,
        ...execution,
      },
      message,
    };

    return { statusCode: 200, body: JSON.stringify(response) };
  } catch (error) {
    console.error("Swap error", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || "Swap failed" }),
    };
  } finally {
    if (client && typeof client.destroy === "function") {
      try {
        await client.destroy();
      } catch (destroyError) {
        console.warn("Failed to destroy Keeta client", destroyError);
      }
    }
  }
}

export const handler = withCors(swap);
