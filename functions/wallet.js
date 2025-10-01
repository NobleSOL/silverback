import { createHash } from "node:crypto";
import * as KeetaNet from "@keetanetwork/keetanet-client";
import { withCors } from "./cors.js";
import {
  DEFAULT_NETWORK,
  decodeMetadata,
  formatAmount,
  loadOfflinePoolContext,
} from "./utils/keeta.js";

const HEX_SEED_REGEX = /^[0-9a-f]{64}$/i;

const DEFAULT_WALLET_TIMEOUT_MS = (() => {
  const candidates = [
    process.env.KEETA_WALLET_TIMEOUT_MS,
    process.env.KEETA_NETWORK_TIMEOUT_MS,
  ];
  for (const value of candidates) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
  }
  return 5000;
})();

function parseBody(body) {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error("Invalid JSON body");
  }
}

function normalizeSeed(seed) {
  if (seed === undefined || seed === null) {
    return "";
  }
  return String(seed).trim();
}

function hashSeedForOffline(seed) {
  const hashed = createHash("sha256").update(seed).digest("hex");
  return hashed.padEnd(64, "0").slice(0, 64);
}

async function attemptWithTimeout(operation, options = {}) {
  const { label = "network operation", timeoutMs = DEFAULT_WALLET_TIMEOUT_MS } =
    options;
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timed out while waiting for ${label} after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  const operationPromise = (async () => operation())();

  try {
    const result = await Promise.race([operationPromise, timeoutPromise]);
    return { ok: true, value: result };
  } catch (error) {
    console.warn(`Falling back after ${label} failed`, error);
    operationPromise.catch((lateError) => {
      if (lateError && lateError !== error) {
        console.warn(`Suppressed late failure for ${label}`, lateError);
      }
    });
    return { ok: false, error };
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function deriveAccount(seed, accountIndex, allowOfflineFallback) {
  const normalizedSeed = normalizeSeed(seed);
  if (!normalizedSeed) {
    throw new Error("A wallet seed is required");
  }

  const usableSeed = HEX_SEED_REGEX.test(normalizedSeed)
    ? normalizedSeed
    : allowOfflineFallback
    ? hashSeedForOffline(normalizedSeed)
    : null;

  if (!usableSeed) {
    throw new Error("Provide a 64-character hexadecimal seed");
  }

  return {
    normalizedSeed,
    account: KeetaNet.lib.Account.fromSeed(usableSeed, accountIndex),
  };
}

function parseOverrides(payload) {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const overrides = {};

  if (payload.poolAccount) {
    overrides.poolAccount = payload.poolAccount;
  }

  if (payload.lpTokenAccount) {
    overrides.lpTokenAccount = payload.lpTokenAccount;
  }

  if (payload.tokenAddresses && typeof payload.tokenAddresses === "object") {
    overrides.tokenAddresses = { ...payload.tokenAddresses };
  }

  return overrides;
}

function parseAccountIndex(index) {
  if (index === undefined || index === null || index === "") {
    return 0;
  }
  const parsed = Number(index);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("Account index must be a non-negative integer");
  }
  return parsed;
}

async function loadBaseTokenDetails(client) {
  const info = await client.client.getAccountInfo(client.baseToken);
  const metadata = decodeMetadata(info.info.metadata);
  const decimals = metadata.decimalPlaces ?? metadata.decimals ?? 0;
  const symbol = metadata.symbol || info.info.name || "KTA";
  return {
    address: client.baseToken.publicKeyString.get(),
    decimals,
    symbol,
    metadata,
    info: info.info,
  };
}

async function loadIdentifier(client, account) {
  try {
    const info = await client.client.getAccountInfo(account);
    const metadata = info?.info?.metadata;
    const possibleValues = [
      metadata?.identifierAccount,
      metadata?.identifier,
      metadata?.account,
    ];
    for (const value of possibleValues) {
      if (!value) {
        continue;
      }
      if (typeof value === "string") {
        return value;
      }
      if (typeof value === "object") {
        if (typeof value?.address === "string") {
          return value.address;
        }
        if (typeof value?.publicKeyString === "string") {
          return value.publicKeyString;
        }
      }
    }
  } catch (infoError) {
    console.warn("Failed to read identifier metadata", infoError);
  }

  try {
    const pending = await client.generateIdentifier(
      KeetaNet.lib.Account.AccountKeyAlgorithm.NETWORK,
      { account }
    );
    return pending.account.publicKeyString.get();
  } catch (error) {
    console.warn("Falling back to account address for identifier", error);
    return account.publicKeyString.get();
  }
}

function buildOfflineWalletResponse({
  normalizedSeed,
  accountIndex,
  account,
  context,
  message,
}) {
  const fallbackContext = context && typeof context === "object" ? context : {};
  const baseTokenContext =
    fallbackContext.baseToken && typeof fallbackContext.baseToken === "object"
      ? fallbackContext.baseToken
      : {};

  const decimalsValue = Number(baseTokenContext.decimals);
  const decimals =
    Number.isFinite(decimalsValue) && decimalsValue >= 0 ? decimalsValue : 0;

  return {
    seed: normalizedSeed,
    accountIndex,
    address: account.publicKeyString.get(),
    identifier: account.publicKeyString.get(),
    network: fallbackContext.network || DEFAULT_NETWORK,
    baseToken: {
      symbol: baseTokenContext.symbol || "KTA",
      address: baseTokenContext.address || "",
      decimals,
      metadata: baseTokenContext.metadata || {},
      balanceRaw: "0",
      balanceFormatted: "0",
    },
    message:
      message ||
      fallbackContext.message ||
      "Wallet details returned without contacting the network",
  };
}

async function walletHandler(event) {
  if (event.httpMethod && event.httpMethod.toUpperCase() === "OPTIONS") {
    return { statusCode: 204, body: "" };
  }

  let client;
  let normalizedSeed = "";
  let accountIndex = 0;
  let account = null;
  let overrides = {};
  let offlineContext = null;
  let lastErrorMessage = "";

  try {
    const payload = parseBody(event.body);
    overrides = parseOverrides(payload);
    accountIndex = parseAccountIndex(payload.accountIndex);
    const derived = deriveAccount(payload.seed, accountIndex, true);
    normalizedSeed = derived.normalizedSeed;
    account = derived.account;

    offlineContext = await loadOfflinePoolContext(overrides);
    if (offlineContext) {
      const response = buildOfflineWalletResponse({
        normalizedSeed,
        accountIndex,
        account,
        context: offlineContext,
        message: "Wallet details fetched from offline fixture",
      });

      return {
        statusCode: 200,
        body: JSON.stringify(response),
      };
    }

    try {
      client = KeetaNet.UserClient.fromNetwork(DEFAULT_NETWORK, account);
      const [identifierLookup, baseTokenLookup, balanceLookup] = await Promise.all([
        attemptWithTimeout(() => loadIdentifier(client, account), {
          label: "wallet identifier lookup",
        }),
        attemptWithTimeout(() => loadBaseTokenDetails(client), {
          label: "base token metadata lookup",
        }),
        attemptWithTimeout(() => client.balance(client.baseToken, { account }), {
          label: "base token balance lookup",
        }),
      ]);

      const identifierAddress = identifierLookup.ok
        ? identifierLookup.value
        : account.publicKeyString.get();

      const baseTokenDetails = baseTokenLookup.ok
        ? baseTokenLookup.value
        : {
            symbol: "KTA",
            address: "",
            decimals: 0,
            metadata: {},
            info: null,
          };

      const balanceRaw = balanceLookup.ok
        ? BigInt(balanceLookup.value)
        : 0n;

      const response = {
        seed: normalizedSeed,
        accountIndex,
        address: account.publicKeyString.get(),
        identifier: identifierAddress,
        network: DEFAULT_NETWORK,
        baseToken: {
          symbol: baseTokenDetails.symbol,
          address: baseTokenDetails.address || "",
          decimals: baseTokenDetails.decimals ?? 0,
          metadata: baseTokenDetails.metadata || {},
          balanceRaw: balanceRaw.toString(),
          balanceFormatted: formatAmount(
            balanceRaw,
            baseTokenDetails.decimals ?? 0
          ),
        },
      };

      const fallbackReasons = [];
      if (!identifierLookup.ok) {
        fallbackReasons.push("identifier");
      }
      if (!baseTokenLookup.ok) {
        fallbackReasons.push("base token metadata");
      }
      if (!balanceLookup.ok) {
        fallbackReasons.push("base token balance");
      }

      if (fallbackReasons.length) {
        response.message = `Wallet details returned with fallback values for ${fallbackReasons.join(", ")}`;
      }

      return {
        statusCode: 200,
        body: JSON.stringify(response),
      };
    } catch (networkError) {
      console.warn(
        "Failed to reach network for wallet lookup, returning stub response",
        networkError
      );

      const fixtureContext = offlineContext || (await loadOfflinePoolContext(overrides));
      const response = buildOfflineWalletResponse({
        normalizedSeed,
        accountIndex,
        account,
        context: fixtureContext || { network: DEFAULT_NETWORK },
        message:
          (fixtureContext && fixtureContext.message) ||
          "Wallet details fetched without contacting the Keeta network",
      });

      return {
        statusCode: 200,
        body: JSON.stringify(response),
      };
    }
  } catch (error) {
    lastErrorMessage = error?.message || "";
    console.error("wallet error", error);

    if (account) {
      let fixtureContext = offlineContext;
      if (!fixtureContext) {
        try {
          fixtureContext = await loadOfflinePoolContext(overrides);
        } catch (fixtureError) {
          console.warn("Failed to reload offline context during error fallback", fixtureError);
        }
      }

      const response = buildOfflineWalletResponse({
        normalizedSeed,
        accountIndex,
        account,
        context: fixtureContext || { network: DEFAULT_NETWORK },
        message:
          (fixtureContext && fixtureContext.message) ||
          (lastErrorMessage
            ? `Wallet details returned without contacting the network (${lastErrorMessage})`
            : "Wallet details returned without contacting the network"),
      });

      return {
        statusCode: 200,
        body: JSON.stringify(response),
      };
    }

    const statusCode = /seed|hex|index/i.test(lastErrorMessage) ? 400 : 500;
    return {
      statusCode,
      body: JSON.stringify({ error: lastErrorMessage || "Wallet lookup failed" }),
    };
  } finally {
    if (client && typeof client.destroy === "function") {
      const destroyResult = await attemptWithTimeout(() => client.destroy(), {
        label: "Keeta client cleanup",
      });
      if (!destroyResult.ok) {
        console.warn("Failed to destroy Keeta client", destroyResult.error);
      }
    }
  }
}

export const handler = withCors(walletHandler);
