/* global BigInt */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import * as KeetaNet from "@keetanetwork/keetanet-client";

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
const DEFAULT_POOL_ACCOUNT =
  process.env.KEETA_POOL_ACCOUNT ||
  "keeta_atki2vx75726w2ez75dbl662t7rhlcbhhvgsps4srwymwzvldrydhzkrl4fng";
const DEFAULT_LP_TOKEN_ACCOUNT =
  process.env.KEETA_LP_TOKEN_ACCOUNT ||
  "keeta_amdjie4di55jfnbh7vhsiophjo27dwv5s4qd5qf7p3q7rppgwbwowwjw6zsfs";

const STATIC_TOKEN_ADDRESSES = {
  RIDE: "keeta_anchh4m5ukgvnx5jcwe56k3ltgo4x4kppicdjgcaftx4525gdvknf73fotmdo",
};

const TOKEN_DECIMAL_OVERRIDES = {};

const EXECUTE_TRANSACTIONS = /^1|true$/i.test(
  process.env.KEETA_EXECUTE_TRANSACTIONS || ""
);

let cachedOfflineFixture = null;
let cachedOfflineFixturePath = null;

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

  if (!context.pool) {
    context.pool = {};
  }
  if (overrides.poolAccount) {
    context.pool.address = overrides.poolAccount;
  }

  if (!context.lpToken) {
    context.lpToken = {};
  }
  if (overrides.lpTokenAccount) {
    context.lpToken.address = overrides.lpTokenAccount;
  }

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

  for (const [rawSymbol, address] of Object.entries(tokenOverrides)) {
    if (!rawSymbol || !address) {
      continue;
    }
    const symbolKey = normalizeSymbol(rawSymbol);
    if (seenSymbols.has(symbolKey)) {
      continue;
    }
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
      if (!metadata[key]) {
        continue;
      }
      const value = metadata[key];
      if (value && typeof value === "object" && !Array.isArray(value)) {
        candidates.push(value.account, value.address, value.tokenAccount, value.token);
      }
      candidates.push(value);
    }
  }

  const nestedGroups = [metadata.tokenAccounts, metadata.tokenAddresses, metadata.tokens, metadata.assets];
  for (const group of nestedGroups) {
    if (!group) {
      continue;
    }
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

async function createClient(options = {}) {
  const { seed, accountIndex = 0 } = options;
  let signer = null;
  if (seed) {
    signer = KeetaNet.lib.Account.fromSeed(seed, accountIndex);
  }
  return KeetaNet.UserClient.fromNetwork(DEFAULT_NETWORK, signer);
}

async function resolveTokenAccount(
  client,
  symbol,
  fallback,
  overrideAddress
) {
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

function normalizeTokenOverrides(overrides = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (!key || !value) continue;
    normalized[key] = value;
    if (typeof key === "string") {
      normalized[key.toUpperCase()] = value;
    }
  }
  return normalized;
}

function resolvePoolMetadataTokenInfo(poolMetadata, index) {
  if (!poolMetadata) {
    return { metadata: {}, decimals: 0 };
  }

  const tokenKey = index === 0 ? "tokenA" : index === 1 ? "tokenB" : null;
  if (!tokenKey) {
    return { metadata: {}, decimals: 0 };
  }

  const entry = poolMetadata[tokenKey];
  const entryObject = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {};
  const decimalCandidates = [
    entryObject.decimalPlaces,
    entryObject.decimals,
    poolMetadata[`${tokenKey}Decimals`],
  ];

  let decimals = 0;
  for (const candidate of decimalCandidates) {
    if (candidate === undefined || candidate === null) {
      continue;
    }
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric >= 0) {
      decimals = numeric;
      break;
    }
  }

  return { metadata: entryObject, decimals };
}

async function loadPoolContext(client, overrides = {}) {
  const poolAccountAddress = overrides.poolAccount || DEFAULT_POOL_ACCOUNT;
  const pool = KeetaNet.lib.Account.toAccount(poolAccountAddress);
  const poolInfo = await client.client.getAccountInfo(pool);
  const poolMetadata = decodeMetadata(poolInfo.info.metadata);
  const tokenSymbols = [poolMetadata.tokenA, poolMetadata.tokenB].filter(Boolean);

  const lpTokenAccount = overrides.lpTokenAccount
    ? KeetaNet.lib.Account.toAccount(overrides.lpTokenAccount)
    : KeetaNet.lib.Account.toAccount(DEFAULT_LP_TOKEN_ACCOUNT);
  const lpTokenInfo = await loadTokenDetails(client, lpTokenAccount);
  const lpSupply = await client.client.getTokenSupply(lpTokenAccount);

  const tokenAddressOverrides = normalizeTokenOverrides(
    overrides.tokenAddresses || {}
  );

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

  const tokenDetails = [];
  const missingTokenSymbols = [];
  for (const [index, symbol] of tokenSymbols.entries()) {
    let fallbackAccount = null;
    const metadataAddress = resolveMetadataTokenAccount(
      poolMetadata,
      symbol,
      index
    );
    const tokenMetadataInfo = resolvePoolMetadataTokenInfo(poolMetadata, index);
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
      missingTokenSymbols.push(symbol);
      tokenDetails.push({
        symbol,
        address: overrideAddress || metadataAddress || "",
        decimals: resolveConfiguredDecimals(symbol, tokenMetadataInfo.decimals),
        info: null,
        metadata: tokenMetadataInfo.metadata || {},
        requiresConfiguration: true,
      });
      continue;
    }
    const details = await loadTokenDetails(client, tokenAccount);
    details.symbol = symbol;
    details.decimals = resolveConfiguredDecimals(symbol, details.decimals);
    tokenDetails.push(details);
  }

  const balances = await client.client.getAllBalances(pool);
  const reserveMap = new Map();
  for (const { token, balance } of balances) {
    reserveMap.set(token.publicKeyString.get(), balance);
  }

  const formattedTokens = tokenDetails.map((token) => {
    const address = token.address || "";
    const decimals = resolveConfiguredDecimals(token.symbol, token.decimals);
    const raw = address ? reserveMap.get(address) || 0n : 0n;
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
    lpToken: {
      symbol: lpTokenInfo.metadata.symbol || lpTokenInfo.info.name,
      address: lpTokenInfo.address,
      decimals: lpTokenInfo.decimals,
      info: lpTokenInfo.info,
      metadata: lpTokenInfo.metadata,
      supplyRaw: lpSupply.toString(),
      supplyFormatted: formatAmount(lpSupply, lpTokenInfo.decimals),
    },
    baseToken,
    timestamp: new Date().toISOString(),
    requiresTokenConfiguration: missingTokenSymbols.length > 0,
    missingTokenSymbols,
  };
}
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
    return balance.toString(); // raw string; can format as needed
  } catch (err) {
    console.error("Failed to fetch balance:", err);
    return "0";
  }
}

export {
  DEFAULT_NETWORK,
  DEFAULT_POOL_ACCOUNT,
  DEFAULT_LP_TOKEN_ACCOUNT,
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
};
