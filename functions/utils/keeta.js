/* global BigInt */
// NOTE: This file matches your repo's style/comments while patching in:
// - No hardcoded pool/LP accounts (reads MARKET_ID from .env or accepts user-supplied IDs)
// - Token symbol/decimals resolved from on-chain metadata (with .env fallbacks)
// - Helpers to dynamically discover a pool for a token pair
// - Kept existing exports/structure so other files continue to work

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import * as KeetaNet from "@keetanetwork/keetanet-client";

/* ----------------------------- Network basics ----------------------------- */

const NETWORK_ALIASES = {
  testnet: "test",
};

const FILE_MODULE_PATH = fileURLToPath(import.meta.url);
const FILE_MODULE_DIR = path.dirname(FILE_MODULE_PATH);
const DEFAULT_OFFLINE_FIXTURE_PATH = path.resolve(
  FILE_MODULE_DIR,
  "../fixtures/poolContext.json"
);

const USE_OFFLINE_FIXTURE = /^1|true$/i.test(
  process.env.KEETA_USE_OFFLINE_FIXTURE || ""
);

function normalizeNetworkName(network) {
  if (!network) {
    return "test";
  }
  const normalized = String(network).trim().toLowerCase();
  if (!normalized) {
    return "test";
  }
  return NETWORK_ALIASES[normalized] || normalized;
}

const DEFAULT_NETWORK = normalizeNetworkName(process.env.KEETA_NETWORK || "test");

/* --------------------------- Static/Env conveniences --------------------------- */

// Addresses we might know statically (rare, but kept for continuity)
const STATIC_TOKEN_ADDRESSES = {
  // Example: RIDE token you referenced. Safe to keep as convenience.
  RIDE: "keeta_anchh4m5ukgvnx5jcwe56k3ltgo4x4kppicdjgcaftx4525gdvknf73fotmdo",
};

// Optional manual overrides when a contract's metadata is wrong/stale.
const TOKEN_DECIMAL_OVERRIDES = {};

// Whether serverless should actually submit tx or only build them.
const EXECUTE_TRANSACTIONS = /^1|true$/i.test(
  process.env.KEETA_EXECUTE_TRANSACTIONS || ""
);

// MARKET_ID is your Silverback DEX/market storage account (router-like origin).
const DEFAULT_MARKET_ID = process.env.MARKET_ID || "";

/* --------------------------------- Caching -------------------------------- */

let cachedOfflineFixture = null;
let cachedOfflineFixturePath = null;

/* ------------------------------- Small utils ------------------------------- */

function deepClone(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeSymbol(symbol) {
  return typeof symbol === "string" && symbol ? symbol.toUpperCase() : "";
}

function resolveOfflineFixturePath() {
  const configured = process.env.KEETA_OFFLINE_FIXTURE;
  if (!configured) {
    return DEFAULT_OFFLINE_FIXTURE_PATH;
  }
  if (path.isAbsolute(configured)) {
    return configured;
  }
  return path.resolve(process.cwd(), configured);
}

async function readOfflineFixture() {
  const fixturePath = resolveOfflineFixturePath();
  if (
    cachedOfflineFixture &&
    cachedOfflineFixturePath &&
    cachedOfflineFixturePath === fixturePath
  ) {
    return cachedOfflineFixture;
  }
  try {
    const contents = await fs.readFile(fixturePath, "utf8");
    const parsed = JSON.parse(contents);
    cachedOfflineFixture = parsed;
    cachedOfflineFixturePath = fixturePath;
    return parsed;
  } catch (error) {
    console.warn("Failed to load offline Keeta fixture", error);
    cachedOfflineFixture = null;
    cachedOfflineFixturePath = null;
    return null;
  }
}

function applyOfflineOverrides(baseContext, overrides = {}) {
  const context = deepClone(baseContext) || {};
  context.timestamp = new Date().toISOString();

  // If user supplied token address overrides, apply them locally
  const tokenOverrides = normalizeTokenOverrides(overrides.tokenAddresses || {});
  const seenSymbols = new Set();

  context.tokens = Array.isArray(context.tokens) ? context.tokens : [];
  context.tokens = context.tokens.map((token) => {
    const symbolKey = normalizeSymbol(token.symbol);
    seenSymbols.add(symbolKey);
    if (symbolKey && tokenOverrides[symbolKey]) {
      return {
        ...token,
        address: tokenOverrides[symbolKey],
        requiresConfiguration: false,
      };
    }
    return token;
  });

  // Add any override tokens that weren't present
  for (const [rawSymbol, address] of Object.entries(tokenOverrides)) {
    if (!rawSymbol || !address) continue;
    const symbolKey = normalizeSymbol(rawSymbol);
    if (seenSymbols.has(symbolKey)) continue;
    const symbol = rawSymbol.toString();
    const token = {
      symbol,
      address,
      decimals: 0,
      info: {},
      metadata: {},
      reserveRaw: "0",
      reserveFormatted: "0",
      requiresConfiguration: false,
    };
    context.tokens.push(token);
    seenSymbols.add(symbolKey);
  }

  context.reserves = context.tokens.reduce((acc, token) => {
    if (token && token.symbol) {
      acc[token.symbol] = token;
    }
    return acc;
  }, {});

  const missing = context.tokens
    .filter((token) => token && token.requiresConfiguration)
    .map((token) => token.symbol)
    .filter(Boolean);

  context.missingTokenSymbols = missing;
  context.requiresTokenConfiguration = missing.length > 0;
  context.message =
    context.message || "Pool state fetched from offline fixture";

  return context;
}

async function loadOfflinePoolContext(overrides = {}) {
  if (!USE_OFFLINE_FIXTURE) {
    return null;
  }
  const fixture = await readOfflineFixture();
  if (!fixture) {
    return null;
  }
  return applyOfflineOverrides(fixture, overrides);
}

function getEnvTokenAddress(symbol) {
  if (!symbol) return null;
  const envKey = `KEETA_TOKEN_${symbol.toUpperCase()}`;
  if (process.env[envKey]) {
    return process.env[envKey];
  }
  const staticKey = symbol.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(STATIC_TOKEN_ADDRESSES, staticKey)) {
    return STATIC_TOKEN_ADDRESSES[staticKey];
  }
  return null;
}

function resolveConfiguredDecimals(symbol, decimals) {
  const key = typeof symbol === "string" ? symbol.toUpperCase() : "";
  if (key && Object.prototype.hasOwnProperty.call(TOKEN_DECIMAL_OVERRIDES, key)) {
    const override = Number(TOKEN_DECIMAL_OVERRIDES[key]);
    if (Number.isFinite(override) && override >= 0) {
      return override;
    }
  }
  const numeric = Number(decimals);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return numeric;
  }
  return 0;
}

function decodeMetadata(metadata) {
  if (!metadata) return {};
  try {
    const buffer = Buffer.from(metadata, "base64");
    if (!buffer.length) return {};
    return JSON.parse(buffer.toString("utf8"));
  } catch (err) {
    return {};
  }
}

function extractAccountAddress(value, seen = new Set()) {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value !== "object") {
    return null;
  }
  if (seen.has(value)) {
    return null;
  }
  seen.add(value);

  if (typeof value.publicKeyString === "string") {
    const trimmed = value.publicKeyString.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  if (value.publicKeyString && typeof value.publicKeyString.get === "function") {
    try {
      const resolved = value.publicKeyString.get();
      if (typeof resolved === "string" && resolved.trim()) {
        return resolved.trim();
      }
    } catch (err) {
      /* ignore invalid getter */
    }
  }

  const candidateKeys = [
    "address",
    "account",
    "accountAddress",
    "publicKey",
    "public_key",
    "publicKeyString",
    "tokenAccount",
    "token",
    "id",
    "value",
  ];

  for (const key of candidateKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      continue;
    }
    const nested = value[key];
    if (!nested) {
      continue;
    }
    const resolved = extractAccountAddress(nested, seen);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function resolveMetadataTokenAccount(metadata, symbol, index) {
  if (!metadata) {
    return null;
  }

  const candidates = [];
  const normalizedSymbol = typeof symbol === "string" ? symbol.toUpperCase() : "";
  const variantSet = new Set();
  if (symbol !== undefined && symbol !== null) {
    variantSet.add(String(symbol));
  }
  if (normalizedSymbol) {
    variantSet.add(normalizedSymbol);
    variantSet.add(normalizedSymbol.toLowerCase());
  }
  const symbolVariants = Array.from(variantSet).filter(Boolean);

  const tokenLetter = index === 0 ? "A" : index === 1 ? "B" : null;
  if (tokenLetter) {
    const baseKey = `token${tokenLetter}`;
    const baseValue = metadata[baseKey];
    if (baseValue && typeof baseValue === "object" && !Array.isArray(baseValue)) {
      candidates.push(baseValue, baseValue.account, baseValue.address, baseValue.tokenAccount, baseValue.token);
    }
    const letterKeys = [`${baseKey}Account`, `${baseKey}Address`];
    for (const key of letterKeys) {
      if (!metadata[key]) continue;
      const value = metadata[key];
      if (value && typeof value === "object" && !Array.isArray(value)) {
        candidates.push(value.account, value.address, value.tokenAccount, value.token);
      }
      candidates.push(value);
    }
  }

  const nestedGroups = [metadata.tokenAccounts, metadata.tokenAddresses, metadata.tokens, metadata.assets];
  for (const group of nestedGroups) {
    if (!group) continue;
    if (Array.isArray(group)) {
      for (const entry of group) {
        if (!entry) continue;
        const entrySymbol =
          (entry.symbol || entry.ticker || entry.token || entry.name || "").toString();
        if (entrySymbol && entrySymbol.toUpperCase() === normalizedSymbol) {
          candidates.push(entry, entry.account, entry.address, entry.tokenAccount, entry.token);
        }
      }
      continue;
    }
    for (const variant of symbolVariants) {
      if (!variant || typeof group !== "object") continue;
      const key = String(variant);
      if (Object.prototype.hasOwnProperty.call(group, key)) {
        candidates.push(group[key]);
      }
      const upperVariant = key.toUpperCase();
      if (Object.prototype.hasOwnProperty.call(group, upperVariant)) {
        candidates.push(group[upperVariant]);
      }
    }
  }

  for (const candidate of candidates) {
    const address = extractAccountAddress(candidate);
    if (address) {
      return address;
    }
  }

  return null;
}

function formatAmount(raw, decimals) {
  const bigRaw = BigInt(raw);
  const absValue = bigRaw < 0n ? -bigRaw : bigRaw;
  const base = 10n ** BigInt(decimals);
  const whole = absValue / base;
  const fraction = (absValue % base).toString().padStart(decimals, "0");
  const trimmedFraction = fraction.replace(/0+$/, "");
  const sign = bigRaw < 0n ? "-" : "";
  return trimmedFraction ? `${sign}${whole}.${trimmedFraction}` : `${sign}${whole}`;
}

function toRawAmount(amount, decimals) {
  if (amount === undefined || amount === null) return 0n;
  const normalized = String(amount).trim();
  if (!normalized) return 0n;
  const negative = normalized.startsWith("-");
  const value = negative ? normalized.slice(1) : normalized;
  if (!/^[0-9]*\.?[0-9]*$/.test(value)) {
    throw new Error(`Invalid numeric amount: ${amount}`);
  }
  const [whole, fraction = ""] = value.split(".");
  const truncatedFraction = fraction.slice(0, decimals);
  const paddedFraction = truncatedFraction.padEnd(decimals, "0");
  const combined = `${whole || "0"}${paddedFraction}`.replace(/^0+(?=\d)/, "");
  const raw = combined ? BigInt(combined) : 0n;
  return negative ? -raw : raw;
}

function sqrtBigInt(value) {
  if (value < 0n) {
    throw new Error("Cannot take square root of negative value");
  }
  if (value < 2n) {
    return value;
  }
  let x0 = value;
  let x1 = (value >> 1n) + 1n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (value / x1 + x1) >> 1n;
  }
  return x0;
}

function calculateSwapQuote(amountIn, reserveIn, reserveOut, feeBps) {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) {
    return {
      amountOut: 0n,
      feePaid: 0n,
      priceImpact: 0,
    };
  }
  const feeDenominator = 10000n;
  const feeNumerator = feeDenominator - BigInt(feeBps ?? 0);
  const amountInWithFee = amountIn * feeNumerator;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * feeDenominator + amountInWithFee;
  const amountOut = denominator === 0n ? 0n : numerator / denominator;
  const feePaid = amountIn - (amountInWithFee / feeDenominator);

  const spotPrice = Number(reserveOut) / Number(reserveIn);
  const newReserveIn = reserveIn + amountIn;
  const newReserveOut = reserveOut - amountOut;
  const newPrice =
    newReserveIn > 0n && newReserveOut > 0n
      ? Number(newReserveOut) / Number(newReserveIn)
      : spotPrice;
  const priceImpact =
    spotPrice === 0 ? 0 : Math.max(0, (spotPrice - newPrice) / spotPrice);

  return {
    amountOut,
    feePaid,
    priceImpact,
  };
}

function calculateLiquidityMint(amountA, amountB, reserveA, reserveB, totalSupply) {
  if (amountA <= 0n || amountB <= 0n) {
    return { minted: 0n, share: 0 };
  }
  if (reserveA === 0n || reserveB === 0n || totalSupply === 0n) {
    const geometricMean = sqrtBigInt(amountA * amountB);
    return { minted: geometricMean, share: 1 };
  }
  const liquidityA = (amountA * totalSupply) / reserveA;
  const liquidityB = (amountB * totalSupply) / reserveB;
  const minted = liquidityA < liquidityB ? liquidityA : liquidityB;
  const share = Number(minted) / Number(totalSupply);
  return { minted, share: Number.isFinite(share) ? share : 0 };
}

function calculateWithdrawal(lpAmount, reserveA, reserveB, totalSupply) {
  if (lpAmount <= 0n || totalSupply <= 0n) {
    return { amountA: 0n, amountB: 0n, share: 0 };
  }
  const amountA = (lpAmount * reserveA) / totalSupply;
  const amountB = (lpAmount * reserveB) / totalSupply;
  const share = Number(lpAmount) / Number(totalSupply);
  return {
    amountA,
    amountB,
    share: Number.isFinite(share) ? share : 0,
  };
}

/* --------------------------------- Clients -------------------------------- */

async function createClient(options = {}) {
  const { seed, accountIndex = 0 } = options;
  let signer = null;
  if (seed) {
    signer = KeetaNet.lib.Account.fromSeed(seed, accountIndex);
  }
  return KeetaNet.UserClient.fromNetwork(DEFAULT_NETWORK, signer);
}

async function loadTokenDetails(client, account) {
  const accountInfo = await client.client.getAccountInfo(account);
  const metadata = decodeMetadata(accountInfo.info.metadata);
  const decimalsRaw = metadata.decimalPlaces ?? metadata.decimals ?? 0;
  const decimals = Number.isFinite(Number(decimalsRaw)) ? Number(decimalsRaw) : 0;
  const symbol =
    metadata.symbol || accountInfo.info.name || account.publicKeyString.get();
  return {
    address: account.publicKeyString.get(),
    account,
    info: accountInfo.info,
    decimals,
    metadata,
    symbol,
  };
}

/* ------------------------ Pool (Market) discovery logic ------------------------ */

/**
 * Attempt to resolve a token "account" (contract) for a symbol, optionally
 * honoring an override address. Falls back to base token for KTA.
 */
async function resolveTokenAccount(client, symbol, fallback, overrideAddress) {
  if (!symbol) return fallback || null;
  if (overrideAddress) {
    try {
      return KeetaNet.lib.Account.toAccount(overrideAddress);
    } catch (error) {
      throw new Error(`Invalid override address provided for ${symbol}`);
    }
  }
  if (symbol.toUpperCase() === "KTA") {
    return client.baseToken;
  }
  const envAddress = getEnvTokenAddress(symbol);
  if (envAddress) {
    return KeetaNet.lib.Account.toAccount(envAddress);
  }
  return fallback || null;
}

/**
 * Helper: find or derive the storage account for a {base, quote} pair.
 * Strategy:
 *  1) If MARKET_ID is provided, ask it for the pool/storage entry for pair.
 *  2) Otherwise, try to read pool metadata you've provided (or overrides).
 *  3) Otherwise, return null and let the caller use overrides.
 *
 * For now, this is a thin placeholder that either returns the provided
 * override or MARKET_ID. You can extend it to query a real registry index.
 */
async function resolveOrDiscoverPool(client, baseSymbol, quoteSymbol, options = {}) {
  const { marketId = DEFAULT_MARKET_ID, poolAccountOverride } = options;

  if (poolAccountOverride) {
    return { poolAccountAddress: poolAccountOverride, source: "override" };
  }

  if (marketId) {
    // In a future patch, query marketId's storage to resolve a concrete pool
    // for (baseSymbol, quoteSymbol). For now, we return marketId as the pool
    // entry-point, which is how your current Flow uses it (router-like origin).
    return { poolAccountAddress: marketId, source: "market" };
  }

  return { poolAccountAddress: "", source: "none" };
}

/**
 * Load a pool context dynamically, pulling symbol/decimals from chain.
 * The "pool" is resolved via MARKET_ID or user-provided overrides; tokens
 * come from the pool metadata and/or overrides/env mapping.
 */
async function loadPoolContext(client, overrides = {}) {
  const tokenAddressOverrides = normalizeTokenOverrides(
    overrides.tokenAddresses || {}
  );

  // Base token (KTA) is always available from client.baseToken
  const baseTokenDetails = await loadTokenDetails(client, client.baseToken);
  const baseSymbol =
    baseTokenDetails.metadata.symbol || baseTokenDetails.info.name || "KTA";
  const baseToken = {
    symbol: baseSymbol,
    address: baseTokenDetails.address,
    decimals: resolveConfiguredDecimals(baseSymbol, baseTokenDetails.decimals),
    info: baseTokenDetails.info,
    metadata: baseTokenDetails.metadata,
  };

  // Resolve "pool account" (router/market storage) entry-point
  const discovery = await resolveOrDiscoverPool(
    client,
    baseSymbol,
    // We don't know the quote yet; UI may pass a suggestion in overrides
    overrides.quoteSymbol || "",
    { marketId: overrides.marketId || DEFAULT_MARKET_ID, poolAccountOverride: overrides.poolAccount }
  );

  const poolAccountAddress = discovery.poolAccountAddress || "";
  let poolInfo = { info: { name: "Pool", description: "", metadata: "" } };
  let poolMetadata = {};

  if (poolAccountAddress) {
    try {
      const pool = KeetaNet.lib.Account.toAccount(poolAccountAddress);
      poolInfo = await client.client.getAccountInfo(pool);
      poolMetadata = decodeMetadata(poolInfo.info.metadata);
    } catch (err) {
      // If the market/router isn't a token account, just continue
      poolInfo = { info: { name: "Pool", description: "", metadata: "" } };
      poolMetadata = {};
    }
  }

  // Determine token symbols for the active market/pair
  // If UI sends specific pair, prefer that; else fallback to metadata
  const tokenSymbols = [];
  if (overrides.tokenSymbols && Array.isArray(overrides.tokenSymbols)) {
    for (const sym of overrides.tokenSymbols) {
      if (sym) tokenSymbols.push(sym);
    }
  } else {
    const metaA = poolMetadata.tokenA || "KTA";
    const metaB = poolMetadata.tokenB || "SBCK";
    tokenSymbols.push(metaA, metaB);
  }

  // Load token details for the declared symbols, respecting overrides/env
  const tokenDetails = [];
  const missingTokenSymbols = [];

  for (const [index, symbol] of tokenSymbols.entries()) {
    let fallbackAccount = null;
    const metadataAddress = resolveMetadataTokenAccount(poolMetadata, symbol, index);
    if (metadataAddress) {
      try {
        fallbackAccount = KeetaNet.lib.Account.toAccount(metadataAddress);
      } catch (error) {
        console.warn(
          `Invalid metadata account address for ${symbol}: ${metadataAddress}`,
          error
        );
      }
    }
    const overrideAddress =
      tokenAddressOverrides[symbol] ||
      tokenAddressOverrides[symbol?.toUpperCase?.()];

    const tokenAccount = await resolveTokenAccount(
      client,
      symbol,
      fallbackAccount,
      overrideAddress
    );

    if (!tokenAccount) {
      // Missing token contract; allow UI to configure
      tokenDetails.push({
        symbol,
        address: overrideAddress || metadataAddress || "",
        decimals: resolveConfiguredDecimals(symbol, 0),
        info: null,
        metadata: {},
        requiresConfiguration: true,
      });
      missingTokenSymbols.push(symbol);
      continue;
    }

    const details = await loadTokenDetails(client, tokenAccount);
    details.symbol = symbol;
    details.decimals = resolveConfiguredDecimals(symbol, details.decimals);
    tokenDetails.push(details);
  }

  // Try to read balances on the "pool" account if it is a token holder;
  // If the pool is a router-like storage account, this may be empty — that's OK.
  const reservesMap = new Map();
  if (poolAccountAddress) {
    try {
      const pool = KeetaNet.lib.Account.toAccount(poolAccountAddress);
      const balances = await client.client.getAllBalances(pool);
      for (const { token, balance } of balances) {
        reservesMap.set(token.publicKeyString.get(), balance);
      }
    } catch (err) {
      // not a token-holding account; skip reserves
    }
  }

  const formattedTokens = tokenDetails.map((token) => {
    const address = token.address || "";
    const decimals = resolveConfiguredDecimals(token.symbol, token.decimals);
    const raw = address ? reservesMap.get(address) || 0n : 0n;
    return {
      symbol: token.symbol,
      address,
      decimals,
      info: token.info,
      metadata: token.metadata,
      reserveRaw: raw.toString(),
      reserveFormatted: formatAmount(raw, decimals),
      requiresConfiguration: Boolean(token.requiresConfiguration),
    };
  });

  // Try to resolve LP token if present in metadata (optional)
  let lpToken = {
    symbol: "LP",
    address: "",
    decimals: 0,
    info: null,
    metadata: {},
    supplyRaw: "0",
    supplyFormatted: "0",
  };
  try {
    const lpAddress =
      poolMetadata?.lpToken?.address ||
      poolMetadata?.lpTokenAddress ||
      poolMetadata?.lpAddress ||
      null;
    if (lpAddress) {
      const lpAccount = KeetaNet.lib.Account.toAccount(lpAddress);
      const lpInfo = await loadTokenDetails(client, lpAccount);
      const supply = await client.client.getTokenSupply(lpAccount);
      lpToken = {
        symbol: lpInfo.metadata.symbol || lpInfo.info.name || "LP",
        address: lpInfo.address,
        decimals: lpInfo.decimals,
        info: lpInfo.info,
        metadata: lpInfo.metadata,
        supplyRaw: supply.toString(),
        supplyFormatted: formatAmount(supply, lpInfo.decimals),
      };
    }
  } catch (err) {
    // Ignore LP if not available
  }

  return {
    network: DEFAULT_NETWORK,
    executeTransactions: EXECUTE_TRANSACTIONS,
    pool: {
      address: poolAccountAddress,
      name: poolInfo.info.name,
      description: poolInfo.info.description,
      metadata: poolMetadata,
      feeBps: poolMetadata.feeBps ?? 30,
    },
    tokens: formattedTokens,
    reserves: formattedTokens.reduce((acc, token) => {
      acc[token.symbol] = token;
      return acc;
    }, {}),
    lpToken,
    baseToken,
    timestamp: new Date().toISOString(),
    requiresTokenConfiguration: missingTokenSymbols.length > 0,
    missingTokenSymbols,
  };
}

/* --------------------------- Wallet convenience --------------------------- */

/**
 * Create a new Keeta wallet from a random seed
 */
async function createWallet() {
  const seed = KeetaNet.lib.Account.randomSeed();
  const account = KeetaNet.lib.Account.fromSeed(seed, 0);
  return {
    seed,
    address: account.publicKeyString.get(),
    account,
  };
}

/**
 * Import an existing wallet from a provided seed (DNA)
 */
async function importWallet(seed, accountIndex = 0) {
  const account = KeetaNet.lib.Account.fromSeed(seed, accountIndex);
  return {
    seed,
    address: account.publicKeyString.get(),
    account,
  };
}

/**
 * Get KTA balance for an address
 */
async function getBalance(client, address) {
  try {
    const account = KeetaNet.lib.Account.toAccount(address);
    const balance = await client.client.getTokenBalance(account);
    return balance.toString(); // raw string
  } catch (err) {
    console.error("Failed to fetch balance:", err);
    return "0";
  }
}

/* --------------------------------- Exports -------------------------------- */

export {
  DEFAULT_NETWORK,
  EXECUTE_TRANSACTIONS,
  normalizeNetworkName,
  calculateLiquidityMint,
  calculateSwapQuote,
  calculateWithdrawal,
  createClient,
  loadOfflinePoolContext,
  decodeMetadata,
  formatAmount,
  loadPoolContext,
  loadTokenDetails,
  toRawAmount,
  createWallet,
  importWallet,
  getBalance,
  // discovery helper (optional usage from handlers/UI)
  resolveOrDiscoverPool,
};
