// functions/getpool.js
import { withCors } from "./cors.js";
import {
  DEFAULT_NETWORK,
  loadOfflinePoolContext,
  createClient,
  resolveOrDiscoverPool,
  loadTokenDetails,
  formatAmount,
} from "./utils/keeta.js";

/** BigInt-safe JSON */
function bigintReplacer(_k, v) {
  return typeof v === "bigint" ? v.toString() : v;
}

function parseBody(body) {
  if (!body) return {};
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export const handler = withCors(async (event) => {
  if (event.httpMethod?.toUpperCase() === "OPTIONS") {
    return { statusCode: 204, body: "" };
  }

  try {
    const overrides = parseBody(event.body);
    const offline = await loadOfflinePoolContext(overrides);
    if (offline) {
      return { statusCode: 200, body: JSON.stringify(offline, bigintReplacer) };
    }

    const client = await createClient();
    const { poolRef, lpTokenRef, tokenARef, tokenBRef, feeBps } =
      await resolveOrDiscoverPool(client, {
        poolAccount: overrides.poolAccount,
        marketId: overrides.marketId,
        tokenAddresses: overrides.tokenAddresses,
      });

    // Get LP and token metadata/decimals/symbols
    const [lpInfo, tokenAInfo, tokenBInfo, baseInfo] = await Promise.all([
      loadTokenDetails(client, lpTokenRef),
      loadTokenDetails(client, tokenARef),
      loadTokenDetails(client, tokenBRef),
      loadTokenDetails(client, client.baseToken),
    ]);

    // Pool reserves from storage balances
    const balances = await client.client.getAllBalances(poolRef);
    const reserveMap = new Map();
    for (const { token, balance } of balances) {
      reserveMap.set(token.publicKeyString.get(), balance);
    }

    const tok = (info) => ({
      symbol: info.symbol,
      address: info.address,
      decimals: info.decimals,
      info: info.info,
      metadata: info.metadata,
      reserveRaw: (reserveMap.get(info.address) || 0n).toString(),
      reserveFormatted: formatAmount(reserveMap.get(info.address) || 0n, info.decimals),
      requiresConfiguration: false,
    });

    const tokenA = tok(tokenAInfo);
    const tokenB = tok(tokenBInfo);

    const lpSupply = await client.client.getTokenSupply(lpTokenRef);

    const payload = {
      network: DEFAULT_NETWORK,
      pool: {
        address: poolRef.publicKeyString.get(),
        feeBps: typeof feeBps === "number" ? feeBps : 30,
      },
      tokens: [tokenA, tokenB],
      reserves: {
        [tokenA.symbol]: tokenA,
        [tokenB.symbol]: tokenB,
      },
      lpToken: {
        symbol: lpInfo.symbol,
        address: lpInfo.address,
        decimals: lpInfo.decimals,
        info: lpInfo.info,
        metadata: lpInfo.metadata,
        supplyRaw: lpSupply.toString(),
        supplyFormatted: formatAmount(lpSupply, lpInfo.decimals),
      },
      baseToken: {
        symbol: baseInfo.symbol,
        address: baseInfo.address,
        decimals: baseInfo.decimals,
        info: baseInfo.info,
        metadata: baseInfo.metadata,
      },
      requiresTokenConfiguration: false,
      overrides: overrides || {},
      timestamp: new Date().toISOString(),
    };

    return { statusCode: 200, body: JSON.stringify(payload, bigintReplacer) };
  } catch (error) {
    console.error("getpool error", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error?.message || "Failed to load pool" }),
    };
  }
});
