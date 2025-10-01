/* global BigInt */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { lib as KeetaLib, UserClient as KeetaUserClient } from "@keetanetwork/keetanet-client";
import LiquidityCard from "./components/LiquidityCard";
import { applyBrandTheme } from "./theme";
import {
  calculateLiquidityQuote,
  calculateSwapQuote,
  calculateWithdrawalQuote,
  formatAmount,
  toRawAmount,
} from "./utils/tokenMath";
import { TOKENS, KTA_LOGO_DATA_URL } from "./config/tokens";

const BRAND_LOGO = [
  "https://cdn.builder.io/api/v1/image/assets%2Fd70091a6f5494e0195b033a72f7e79ae%2F116ddd439df04721809dcdc66245",
  "e3fa?format=webp&width=800",
].join("");

const TOKEN_ICON_PATHS = {
  usdc: "/tokens/usdc.svg",
  sol: "/tokens/sol.svg",
  eth: "/tokens/eth.svg",
  btc: "/tokens/btc.svg",
  kusd: "/tokens/kusd.svg",
  kta: TOKENS.KTA.logo,
  ride: TOKENS.RIDE.logo,
  sbck: TOKENS.SBCK?.logo || "/tokens/default.svg",
  test: "/tokens/default.svg",
};

const KEETA_NETWORK_PREFERENCES = ["testnet", "test"];

const RIDE_TOKEN_ADDRESS = "keeta_anchh4m5ukgvnx5jcwe56k3ltgo4x4kppicdjgcaftx4525gdvknf73fotmdo";
const DEFAULT_POOL_OVERRIDES = Object.freeze({
  tokenAddresses: Object.freeze({
    RIDE: RIDE_TOKEN_ADDRESS,
  }),
});
const POOL_OVERRIDE_STORAGE_KEY = "silverback.pool.overrides";

function cloneOverrides(overrides = {}) {
  const clone = {};
  if (overrides.poolAccount) {
    clone.poolAccount = overrides.poolAccount;
  }
  if (overrides.lpTokenAccount) {
    clone.lpTokenAccount = overrides.lpTokenAccount;
  }
  if (overrides.tokenAddresses && typeof overrides.tokenAddresses === "object") {
    clone.tokenAddresses = { ...overrides.tokenAddresses };
  }
  return clone;
}

function mergeOverrideObjects(base = {}, updates = {}) {
  const merged = cloneOverrides(base);

  if (Object.prototype.hasOwnProperty.call(updates, "poolAccount")) {
    const value = typeof updates.poolAccount === "string" ? updates.poolAccount.trim() : updates.poolAccount;
    if (value) {
      merged.poolAccount = value;
    } else {
      delete merged.poolAccount;
    }
  }

  if (Object.prototype.hasOwnProperty.call(updates, "lpTokenAccount")) {
    const value = typeof updates.lpTokenAccount === "string" ? updates.lpTokenAccount.trim() : updates.lpTokenAccount;
    if (value) {
      merged.lpTokenAccount = value;
    } else {
      delete merged.lpTokenAccount;
    }
  }

  if (updates.tokenAddresses && typeof updates.tokenAddresses === "object") {
    const current = merged.tokenAddresses ? { ...merged.tokenAddresses } : {};
    for (const [key, rawValue] of Object.entries(updates.tokenAddresses)) {
      if (!key) continue;
      const normalizedKey = String(key).toUpperCase();
      const value = typeof rawValue === "string" ? rawValue.trim() : rawValue;
      if (value) {
        current[normalizedKey] = value;
      } else {
        delete current[normalizedKey];
      }
    }
    if (Object.keys(current).length > 0) {
      merged.tokenAddresses = current;
    } else {
      delete merged.tokenAddresses;
    }
  } else if (merged.tokenAddresses) {
    merged.tokenAddresses = { ...merged.tokenAddresses };
  }

  return merged;
}

async function createKeetaClient(account) {
  let lastError = null;
  for (const network of KEETA_NETWORK_PREFERENCES) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await KeetaUserClient.fromNetwork(network, account || undefined);
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) {
    throw lastError;
  }
  throw new Error("Unable to initialize Keeta client");
}

function formatKeetaBalance(rawBalance) {
  try {
    const balance = BigInt(rawBalance ?? 0);
    const divisor = 1_000_000_000n;
    const negative = balance < 0n;
    const absolute = negative ? -balance : balance;
    const whole = absolute / divisor;
    const fraction = (absolute % divisor).toString().padStart(9, "0");
    const trimmedFraction = fraction.replace(/0+$/, "");
    const prefix = negative ? "-" : "";
    return trimmedFraction ? `${prefix}${whole}.${trimmedFraction}` : `${prefix}${whole}`;
  } catch (error) {
    return "0";
  }
}

function extractAccountAddress(value, seen = new Set()) {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed;
  }

  if (typeof value !== "object") {
    return "";
  }

  if (seen.has(value)) {
    return "";
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
    } catch (error) {
      /* ignore getter errors */
    }
  }

  if (typeof value.address === "string" && value.address.trim()) {
    return value.address.trim();
  }

  if (value.address && typeof value.address.get === "function") {
    try {
      const resolved = value.address.get();
      if (typeof resolved === "string" && resolved.trim()) {
        return resolved.trim();
      }
    } catch (error) {
      /* ignore getter errors */
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
    const resolved = extractAccountAddress(nested, seen);
    if (resolved) {
      return resolved;
    }
  }

  return "";
}

function resolveBalanceMetadata(entry, index) {
  const seen = new Set();
  const candidates = [
    entry?.accountId,
    entry?.account,
    entry?.tokenAccount,
    entry?.token,
    entry?.address,
  ];

  for (const candidate of candidates) {
    const resolved = extractAccountAddress(candidate, seen);
    if (resolved) {
      return { address: resolved, label: resolved };
    }
  }

  const labelCandidates = [
    entry?.symbol,
    entry?.tokenSymbol,
    entry?.tokenName,
    entry?.name,
  ];
  for (const label of labelCandidates) {
    if (typeof label === "string" && label.trim()) {
      return { address: "", label: label.trim() };
    }
  }

  return { address: "", label: `Balance ${index + 1}` };
}

function SwapIcon() {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-hidden="true"
    >
      <path
        d="M7 7h11M7 7l3-3M7 7l3 3M17 17H6m11 0l-3-3m3 3l-3 3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowTopRight() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M7 17L17 7M17 7H9M17 7V15"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function getTokenIconUrl(symbol) {
  const key = String(symbol || "").toLowerCase();
  return TOKEN_ICON_PATHS[key] || "/tokens/default.svg";
}

function getKnownTokenConfig(symbol) {
  const key = String(symbol || "").toUpperCase();
  return TOKENS[key];
}

function normalizeConfigDecimals(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function withTokenLogo(token) {
  if (!token || !token.symbol) {
    return token;
  }
  const config = getKnownTokenConfig(token.symbol);
  if (!config) {
    return token;
  }

  let next = token;
  if (config.logo && token.logo !== config.logo) {
    next = next === token ? { ...token } : next;
    next.logo = config.logo;
  }

  const overrideDecimals = normalizeConfigDecimals(config.decimals);
  if (overrideDecimals !== null && token.decimals !== overrideDecimals) {
    next = next === token ? { ...token } : next;
    next.decimals = overrideDecimals;
  }

  return next;
}

function getTokenLogoSource(symbol) {
  const config = getKnownTokenConfig(symbol);
  if (config?.logo) {
    return config.logo;
  }
  return getTokenIconUrl(symbol);
}

const FALLBACK_TOKEN_ICON = "/tokens/default.svg";

function symbolsEqual(a, b) {
  if (!a || !b) return false;
  return String(a).toUpperCase() === String(b).toUpperCase();
}

function resolveBaseTokenBalance(baseToken) {
  if (!baseToken) return null;
  if (baseToken.balanceFormatted != null) {
    return baseToken.balanceFormatted;
  }
  if (baseToken.balanceRaw != null && baseToken.decimals != null) {
    try {
      return formatAmount(baseToken.balanceRaw, baseToken.decimals);
    } catch (error) {
      return null;
    }
  }
  return null;
}

const INITIAL_WALLET_STATE = {
  seed: "",
  index: 0,
  address: "",
  identifier: "",
  network: "",
  baseToken: null,
  loading: false,
  error: "",
  balances: [],
  balanceLoading: false,
  balanceError: "",
  account: null,
};

function TokenBadge({ symbol, logo }) {
  const initialSrc = useMemo(() => logo || getTokenLogoSource(symbol), [symbol, logo]);
  const [src, setSrc] = useState(initialSrc);
  useEffect(() => {
    setSrc(logo || getTokenLogoSource(symbol));
  }, [symbol, logo]);
  const handleError = () => {
    const upper = String(symbol || "").toUpperCase();
    if (upper === "KTA" && src !== KTA_LOGO_DATA_URL) {
      setSrc(KTA_LOGO_DATA_URL);
      return;
    }
    if (src !== FALLBACK_TOKEN_ICON) {
      setSrc(FALLBACK_TOKEN_ICON);
    }
  };
  return (
    <img
      className="token-img"
      src={src}
      alt={symbol ? `${symbol} logo` : "Token logo"}
      onError={handleError}
    />
  );
}

function TokenSelect({ value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedSymbol = useMemo(() => {
    if (value && typeof value === "object") {
      return value.symbol || "";
    }
    return typeof value === "string" ? value : "";
  }, [value]);
  const selectedLogo = useMemo(() => {
    if (value && typeof value === "object") {
      return value.logo;
    }
    return undefined;
  }, [value]);
  const filtered = useMemo(() => {
    const lower = query.toLowerCase();
    return options.filter(
      (option) =>
        option.symbol.toLowerCase().includes(lower) ||
        option.name.toLowerCase().includes(lower)
    );
  }, [options, query]);

  const closePopover = () => {
    setOpen(false);
    setQuery("");
  };

  const handleSelect = (symbol) => {
    if (!onChange) {
      closePopover();
      return;
    }
    const next = options.find((option) => symbolsEqual(option.symbol, symbol)) || null;
    onChange(next);
    closePopover();
  };

  return (
    <div className="token-select" data-open={open}>
      <button
        type="button"
        className="token-trigger"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="token-trigger-icon">
          <TokenBadge symbol={selectedSymbol} logo={selectedLogo} />
        </span>
        <span className="token-trigger-symbol">{selectedSymbol || "Select"}</span>
      </button>
      {open && (
        <div className="token-popover" role="listbox">
          <input
            className="token-search"
            placeholder="Search token"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="token-list">
            {filtered.map((option) => (
              <button
                key={option.symbol}
                type="button"
                className={`token-item${
                  symbolsEqual(option.symbol, selectedSymbol) ? " is-active" : ""
                }`}
                onClick={() => handleSelect(option.symbol)}
              >
                <span className="token-icon">
                  <TokenBadge symbol={option.symbol} logo={option.logo} />
                </span>
                <div className="token-info">
                  <span className="token-symbol">{option.symbol}</span>
                  <span className="token-name">{option.name}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatAddress(address) {
  if (!address) return "";
  if (address.length <= 12) return address;
  return `${address.slice(0, 10)}…${address.slice(-6)}`;
}

function sanitizeBaseToken(token) {
  if (!token || typeof token !== "object") {
    return null;
  }
  const symbol = typeof token.symbol === "string" ? token.symbol : "";
  const address = typeof token.address === "string" ? token.address : "";
  const decimalsRaw = token.decimals;
  let decimals = Number.isFinite(Number(decimalsRaw)) ? Number(decimalsRaw) : null;
  const balanceRaw =
    token.balanceRaw != null && typeof token.balanceRaw.toString === "function"
      ? token.balanceRaw.toString()
      : null;
  const balanceFormatted =
    typeof token.balanceFormatted === "string" ? token.balanceFormatted : null;
  const metadata = token.metadata && typeof token.metadata === "object" ? token.metadata : {};

  const config = getKnownTokenConfig(symbol);
  const overrideDecimals = normalizeConfigDecimals(config?.decimals);
  if (overrideDecimals !== null) {
    decimals = overrideDecimals;
  }

  return {
    symbol,
    address,
    decimals,
    balanceRaw,
    balanceFormatted,
    metadata,
  };
}

function sanitizeWalletPayload(payload, fallbackAddress) {
  if (!payload || typeof payload !== "object") {
    return {
      address: fallbackAddress,
      identifier: "",
      network: "",
      baseToken: null,
    };
  }

  const normalizedAddress =
    typeof payload.address === "string" && payload.address.trim()
      ? payload.address.trim()
      : fallbackAddress;

  const identifier =
    typeof payload.identifier === "string" && payload.identifier.trim()
      ? payload.identifier.trim()
      : "";

  const network = typeof payload.network === "string" ? payload.network : "";

  return {
    address: normalizedAddress,
    identifier,
    network,
    baseToken: sanitizeBaseToken(payload.baseToken),
  };
}

function parseWalletResponse(text) {
  if (!text) {
    return {};
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return {};
  }

  const candidates = new Set([trimmed]);

  const objectStart = trimmed.indexOf("{");
  const arrayStart = trimmed.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  const objectEnd = trimmed.lastIndexOf("}");
  const arrayEnd = trimmed.lastIndexOf("]");
  const ends = [objectEnd, arrayEnd].filter((index) => index >= 0);

  if (starts.length && ends.length) {
    const envelopeStart = Math.min(...starts);
    const envelopeEnd = Math.max(...ends);
    if (envelopeStart < envelopeEnd) {
      candidates.add(trimmed.slice(envelopeStart, envelopeEnd + 1));
    }
  }

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    try {
      return JSON.parse(candidate);
    } catch (error) {
      /* try next candidate */
    }
  }

  throw new Error("Invalid wallet response");
}

function WalletControls({ wallet, onWalletChange }) {
  const [seedInput, setSeedInput] = useState(wallet.seed || "");
  const [indexInput, setIndexInput] = useState(wallet.index || 0);
  const [status, setStatus] = useState("");
  const balances = wallet.balances || [];
  const balanceLoading = Boolean(wallet.balanceLoading);
  const balanceError = wallet.balanceError || "";

  useEffect(() => {
    setSeedInput(wallet.seed || "");
    setIndexInput(wallet.index || 0);
  }, [wallet.seed, wallet.index]);

  const baseTokenBalance = resolveBaseTokenBalance(wallet.baseToken);
  const walletLoading = Boolean(wallet.loading);

  const requestWalletDetails = useCallback(async (seedValue, accountIndexValue) => {
    const response = await fetch("/.netlify/functions/wallet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        seed: seedValue,
        accountIndex: accountIndexValue,
        allowOfflineFallback: true,
      }),
    });

    const text = await response.text();
    let payload = {};
    if (text) {
      try {
        payload = parseWalletResponse(text);
      } catch (error) {
        throw new Error(error.message || "Invalid wallet response");
      }
    }

    if (!response.ok) {
      throw new Error(payload.error || "Failed to load wallet details");
    }

    return payload;
  }, []);

  const handleGenerate = () => {
    const generated = KeetaLib.Account.generateRandomSeed({ asString: true });
    setSeedInput(generated);
    setIndexInput(0);
    setStatus("Generated random seed (not saved)");
  };

  const handleConnect = async () => {
    const trimmed = seedInput.trim();
    const index = Number(indexInput) || 0;
    try {
      if (!trimmed) {
        throw new Error("Provide a 64-character hex seed");
      }
      if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
        throw new Error("Provide a 64-character hexadecimal seed");
      }
      const account = KeetaLib.Account.fromSeed(trimmed, index);
      const address = account.publicKeyString.get();

      setStatus(`Connecting ${formatAddress(address)}...`);
      onWalletChange({
        ...INITIAL_WALLET_STATE,
        seed: trimmed,
        index,
        loading: true,
        error: "",
        balanceError: "",
        balances: [],
        balanceLoading: false,
        address: "",
        identifier: "",
        network: "",
        baseToken: null,
        account: null,
      });

      let payload;
      try {
        payload = await requestWalletDetails(trimmed, index);
      } catch (requestError) {
        onWalletChange({
          ...INITIAL_WALLET_STATE,
          seed: trimmed,
          index,
          loading: false,
          error: requestError.message,
          balanceLoading: false,
          address: "",
          identifier: "",
          network: "",
          baseToken: null,
          balances: [],
          account: null,
        });
        setStatus(`Failed to load wallet details: ${requestError.message}`);
        return;
      }

      const sanitized = sanitizeWalletPayload(payload, address);
      onWalletChange({
        ...INITIAL_WALLET_STATE,
        seed: trimmed,
        index,
        address: sanitized.address,
        identifier: sanitized.identifier,
        network: sanitized.network,
        baseToken: sanitized.baseToken,
        balances: [],
        balanceError: "",
        loading: false,
        balanceLoading: false,
        error: "",
        account,
      });
      setStatus(`Connected ${formatAddress(sanitized.address)}`);
    } catch (error) {
      onWalletChange({
        ...INITIAL_WALLET_STATE,
        seed: trimmed,
        index,
        loading: false,
        error: error.message,
        balanceLoading: false,
        address: "",
        identifier: "",
        network: "",
        baseToken: null,
        balances: [],
        account: null,
      });
      setStatus(error.message);
    }
  };

  return (
    <div className="swap-card wallet-card" id="wallet-panel">
      <div className="swap-card-header">
        <div className="swap-card-title">
          <span className="swap-chip">Keeta testnet</span>
          <h2>Wallet</h2>
        </div>
      </div>
      <p className="wallet-copy">
        Use a testnet seed to sign swaps and liquidity transactions. Keep this value private when you deploy.
      </p>
      <div className="field-group">
        <label className="field-label" htmlFor="wallet-seed">
          Seed
        </label>
        <input
          id="wallet-seed"
          type="text"
          value={seedInput}
          onChange={(event) => setSeedInput(event.target.value)}
          placeholder="64-character hex seed"
          spellCheck="false"
          autoComplete="off"
        />
      </div>
      <div className="field-group">
        <label className="field-label" htmlFor="wallet-index">
          Account index
        </label>
        <input
          id="wallet-index"
          type="number"
          min="0"
          value={indexInput}
          onChange={(event) => setIndexInput(Number(event.target.value) || 0)}
        />
        <p className="field-caption">
          Derives alternate wallet addresses from the same seed (advanced). Use 0 for the primary account.
        </p>
      </div>
      <div className="field-group">
        <label className="field-label">Actions</label>
        <div className="hero-actions">
          <button type="button" className="ghost-cta" onClick={handleGenerate}>
            Generate seed
          </button>
          <button
            type="button"
            className="primary-cta"
            onClick={handleConnect}
            disabled={walletLoading}
          >
            {walletLoading
              ? "Connecting..."
              : wallet.address
              ? "Reconnect"
              : "Connect"}
          </button>
        </div>
      </div>
      {wallet.address && (
        <div className="info-line">
          Connected address: <code className="wallet-address">{wallet.address}</code>
        </div>
      )}
      {balanceLoading && <p className="status">Loading balances…</p>}
      {balanceError && <p className="status">{balanceError}</p>}
      {wallet.address && !balanceLoading && !balanceError && (
        <div className="wallet-balances">
          <h3>Balances</h3>
          {balances.length === 0 ? (
            <p className="empty">No balances found</p>
          ) : (
            <ul>
              {balances.map((entry, index) => {
                const label = entry.accountLabel || entry.accountId || `Balance ${index + 1}`;
                const key = entry.balanceKey || entry.accountId || `${label}-${index}`;
                return (
                  <li key={key}>
                    <span className="token-id">{label}</span>
                    <span className="token-value">{entry.formatted}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {wallet.baseToken && (
        <div className="info-line">
          Balance: {walletLoading
            ? "Loading..."
            : baseTokenBalance != null
            ? `${baseTokenBalance} ${wallet.baseToken.symbol || ""}`.trim()
            : "—"}
        </div>
      )}
      {status && <p className="status">{status}</p>}
    </div>
  );
}

function usePoolState() {
  const getInitialOverrides = () => {
    const base = cloneOverrides(DEFAULT_POOL_OVERRIDES);
    if (typeof window === "undefined") {
      return base;
    }
    try {
      const stored = window.localStorage.getItem(POOL_OVERRIDE_STORAGE_KEY);
      if (!stored) {
        return base;
      }
      const parsed = JSON.parse(stored);
      if (!parsed || typeof parsed !== "object") {
        return base;
      }
      return mergeOverrideObjects(base, parsed);
    } catch (error) {
      return base;
    }
  };

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [overrideSnapshot, setOverrideSnapshot] = useState(getInitialOverrides);
  const overridesRef = useRef(cloneOverrides(overrideSnapshot));

  const persistOverrides = useCallback((overrides) => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      if (!overrides || Object.keys(overrides).length === 0) {
        window.localStorage.removeItem(POOL_OVERRIDE_STORAGE_KEY);
      } else {
        window.localStorage.setItem(
          POOL_OVERRIDE_STORAGE_KEY,
          JSON.stringify(overrides)
        );
      }
    } catch (storageError) {
      // eslint-disable-next-line no-console
      console.warn("Failed to persist pool overrides", storageError);
    }
  }, []);

  const mergeOverrides = useCallback((current, updates = {}) => {
    return mergeOverrideObjects(current || {}, updates);
  }, []);

  const fetchPool = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/.netlify/functions/getpool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(overridesRef.current || {}),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load pool");
      }
      setData(payload);
      const snapshot = cloneOverrides(overridesRef.current || {});
      setOverrideSnapshot(snapshot);
      persistOverrides(snapshot);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [persistOverrides]);

  const refresh = useCallback(
    async (nextOverrides) => {
      overridesRef.current = mergeOverrides(overridesRef.current, nextOverrides);
      const snapshot = cloneOverrides(overridesRef.current || {});
      setOverrideSnapshot(snapshot);
      persistOverrides(snapshot);
      return fetchPool();
    },
    [fetchPool, mergeOverrides, persistOverrides]
  );

  const setOverrides = useCallback(
    async (nextOverrides = {}) => {
      overridesRef.current = mergeOverrideObjects(DEFAULT_POOL_OVERRIDES, nextOverrides);
      const snapshot = cloneOverrides(overridesRef.current || {});
      setOverrideSnapshot(snapshot);
      persistOverrides(snapshot);
      return fetchPool();
    },
    [fetchPool, persistOverrides]
  );

  useEffect(() => {
    fetchPool();
  }, [fetchPool]);

  return { data, loading, error, refresh, setOverrides, overrides: overrideSnapshot };
}

function Header({ view, onNavigate, wallet, onConnectClick }) {
  const handleNav = (target, path, scrollTarget) => (event) => {
    event.preventDefault();
    onNavigate(target, path, scrollTarget);
  };

  return (
    <header className="site-header">
      <nav className="top-nav">
        <a href="/" className="brand" onClick={handleNav("swap", "/", "swap")}>
          <img src={BRAND_LOGO} alt="Silverback" className="brand-mark" />
          <span className="brand-word">SILVERBACK</span>
        </a>
        <div className="nav-pill">
          <a
            href="/"
            className={`nav-pill-item${view === "swap" ? " is-active" : ""}`}
            onClick={handleNav("swap", "/", "swap")}
          >
            Swap
          </a>
          <a
            href="/pools"
            className={`nav-pill-item${view === "pools" ? " is-active" : ""}`}
            onClick={handleNav("pools", "/pools", "pools")}
          >
            Pools
          </a>
          <a
            href="/#stats"
            className="nav-pill-item"
            onClick={handleNav("swap", "/", "stats")}
          >
            Stats
          </a>
        </div>
        <div className="nav-actions">
          <button className="link-action" type="button">
            Docs
          </button>
          <button className="connect-button" type="button" onClick={onConnectClick}>
            {wallet?.address ? formatAddress(wallet.address) : "Connect"}
          </button>
        </div>
      </nav>
    </header>
  );
}

function Footer({ onNavigate }) {
  const handleNav = (target, path, scrollTarget) => (event) => {
    if (!onNavigate) {
      return;
    }
    event.preventDefault();
    onNavigate(target, path, scrollTarget);
  };

  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <img src={BRAND_LOGO} alt="Silverback" className="brand-mark" />
          <div>
            <div className="brand-word">SILVERBACK</div>
            <p className="footer-tagline">The native DEX of the Keeta ecosystem.</p>
          </div>
        </div>
        <div className="footer-links">
          <a href="/" onClick={handleNav("swap", "/", "swap")}>
            Swap
          </a>
          <a href="/pools" onClick={handleNav("pools", "/pools", "pools")}>
            Pools
          </a>
          <a href="/#stats" onClick={handleNav("swap", "/", "stats")}>
            Stats
          </a>
        </div>
        <span className="footer-copy">© {new Date().getFullYear()} Silverback Labs</span>
      </div>
    </footer>
  );
}

function SwapPage({ wallet, onWalletChange, onNavigate, poolState }) {
  const {
    data: poolData,
    loading: poolLoading,
    error: poolError,
    refresh,
    overrides: poolOverrides,
  } = poolState;
  const tokenOptions = useMemo(() => {
    const seen = new Set();
    const options = [];

    const addOption = (token) => {
      if (!token?.symbol || token?.requiresConfiguration) return;
      const key = token.symbol.toUpperCase();
      if (seen.has(key)) return;
      seen.add(key);
      const enriched = withTokenLogo(token);
      const config = getKnownTokenConfig(token.symbol);
      options.push({
        symbol: enriched.symbol,
        name:
          token.info?.name ||
          token.metadata?.name ||
          enriched.name ||
          config?.name ||
          enriched.symbol,
        logo: enriched.logo || config?.logo,
      });
    };

    addOption(TOKENS.KTA);
    addOption(TOKENS.SBCK);

    if (poolData?.baseToken) {
      addOption(poolData.baseToken);
    }

    (poolData?.tokens || []).forEach(addOption);

    return options;
  }, [poolData]);

  const tokenMap = useMemo(() => {
    const map = {};
    const registerToken = (token) => {
      if (!token?.symbol || token?.requiresConfiguration) return;
      const enriched = withTokenLogo(token);
      const entry = { ...enriched };
      map[entry.symbol] = entry;
      if (enriched.address) {
        map[enriched.address] = entry;
      }
    };

    (poolData?.tokens || []).forEach(registerToken);

    if (poolData?.baseToken?.symbol) {
      const key = poolData.baseToken.symbol;
      if (!map[key]) {
        const reserve = poolData?.reserves?.[key];
        registerToken({
          ...poolData.baseToken,
          reserveRaw: reserve?.reserveRaw || poolData.baseToken.reserveRaw || "0",
          reserveFormatted:
            reserve?.reserveFormatted || poolData.baseToken.reserveFormatted || "0",
        });
      }
    }

    return map;
  }, [poolData]);

  const walletBaseToken = wallet?.baseToken || null;
  const walletLoading = Boolean(wallet?.loading);
  const walletBaseTokenBalance = resolveBaseTokenBalance(walletBaseToken);

  const [fromToken, setFromToken] = useState(TOKENS.KTA);
  const [toToken, setToToken] = useState(TOKENS.SBCK);

  const fromAsset = fromToken?.symbol || "";
  const toAsset = toToken?.symbol || "";

  useEffect(() => {
    if (!tokenOptions.length) {
      if (!symbolsEqual(fromAsset, TOKENS.KTA.symbol)) {
        setFromToken(TOKENS.KTA);
      }
      if (toToken) {
        setToToken(null);
      }
      return;
    }

    const findOption = (symbol) =>
      tokenOptions.find((option) => symbolsEqual(option.symbol, symbol));

    const prioritizedFrom = [fromAsset, TOKENS.KTA.symbol, tokenOptions[0]?.symbol];
    let nextFrom = null;
    for (const candidate of prioritizedFrom) {
      if (!candidate) continue;
      const match = findOption(candidate);
      if (match) {
        nextFrom = match;
        break;
      }
    }
    if (!nextFrom) {
      nextFrom = tokenOptions[0];
    }
    if (!fromToken || fromToken !== nextFrom) {
      if (!fromToken || !symbolsEqual(fromToken.symbol, nextFrom.symbol) || fromToken.logo !== nextFrom.logo) {
        setFromToken(nextFrom);
      }
    }

    const prioritizedTo = [toAsset, TOKENS.SBCK?.symbol];
    let nextTo = null;
    for (const candidate of prioritizedTo) {
      if (!candidate) continue;
      const match = findOption(candidate);
      if (match) {
        nextTo = match;
        break;
      }
    }
    if (!nextTo || symbolsEqual(nextTo.symbol, nextFrom.symbol)) {
      nextTo = tokenOptions.find((option) => !symbolsEqual(option.symbol, nextFrom.symbol)) || null;
    }

    if (toToken !== nextTo) {
      const shouldUpdate =
        (!toToken && nextTo) ||
        (toToken && (!nextTo || !symbolsEqual(toToken.symbol, nextTo.symbol) || toToken.logo !== nextTo.logo));
      if (shouldUpdate) {
        setToToken(nextTo);
      }
    }
  }, [tokenOptions, fromAsset, toAsset, fromToken, toToken]);

  const handleFromTokenChange = useCallback((option) => {
    setFromToken(option || null);
  }, []);

  const handleToTokenChange = useCallback((option) => {
    setToToken(option || null);
  }, []);

  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [status, setStatus] = useState("");
  const [quoteDetails, setQuoteDetails] = useState(null);
  const [slippageBps, setSlippageBps] = useState(50);
  const [slippageOpen, setSlippageOpen] = useState(false);
  const [activeSwapTab, setActiveSwapTab] = useState("swap");
  const slippagePercentDisplay = useMemo(() => {
    const value = Number(slippageBps);
    if (!Number.isFinite(value) || value < 0) {
      return "0%";
    }
    return `${(value / 100).toFixed(2)}%`;
  }, [slippageBps]);

  useEffect(() => {
    if (!poolData) {
      setToAmount("");
      return;
    }
    const tokenIn = tokenMap[fromAsset];
    const tokenOut = tokenMap[toAsset];
    if (!tokenIn || !tokenOut) {
      setToAmount("");
      return;
    }
    try {
      const amountInRaw = toRawAmount(fromAmount, tokenIn.decimals);
      if (amountInRaw <= 0n) {
        setToAmount("");
        return;
      }
      const reserveIn = BigInt(tokenIn.reserveRaw);
      const reserveOut = BigInt(tokenOut.reserveRaw);
      const { amountOut } = calculateSwapQuote(
        amountInRaw,
        reserveIn,
        reserveOut,
        poolData.pool.feeBps
      );
      if (amountOut <= 0n) {
        setToAmount("");
        setQuoteDetails(null);
        return;
      }

      const expectedFormatted = formatAmount(amountOut, tokenOut.decimals);

      // 🔑 live slippage calc
      const slippageMultiplier = BigInt(10_000 - slippageBps);
      const minOutRaw = (amountOut * slippageMultiplier) / 10_000n;
      const minimumFormatted = formatAmount(minOutRaw, tokenOut.decimals);

      setToAmount(expectedFormatted);
      setQuoteDetails({
        tokens: {
          from: { symbol: fromAsset },
          to: {
            symbol: toAsset,
            expectedFormatted,
            expectedRaw: amountOut.toString(),
            minimumFormatted,
          },
        },
        priceImpact: "—", // placeholder until swap response
      });
    } catch (error) {
      setToAmount("");
      setQuoteDetails(null);
    }
  }, [fromAmount, fromAsset, toAsset, poolData, tokenMap, slippageBps]);


  const flipDirection = () => {
    const previousFrom = fromToken;
    const previousTo = toToken;
    setFromToken(previousTo || previousFrom || null);
    setToToken(previousFrom || previousTo || null);
    setFromAmount(toAmount);
    setToAmount(fromAmount);
    setQuoteDetails(null);
  };

    const handleSwap = async () => {
    if (!fromAmount) {
      setStatus("Enter an amount to swap");
      return;
    }
    if (!wallet?.seed) {
      setStatus("Connect a testnet wallet seed first");
      return;
    }

    const tokenIn = tokenMap[fromAsset];
    const tokenOut = tokenMap[toAsset];
    const poolAddress = poolData?.pool?.address;

    if (!tokenIn || !tokenOut) {
      setStatus("Selected token pair is not supported");
      return;
    }

    if (!poolAddress) {
      setStatus("Pool is unavailable. Refresh and try again.");
      return;
    }

    const amountInRaw = toRawAmount(fromAmount, tokenIn.decimals);
    if (amountInRaw <= 0n) {
      setStatus("Swap amount must be greater than zero");
      return;
    }

    setStatus("Preparing swap...");
    setQuoteDetails(null);

    try {
      const tokenOverrides = poolOverrides?.tokenAddresses
        ? { ...poolOverrides.tokenAddresses }
        : undefined;
      const poolOverrideAccount = (poolOverrides?.poolAccount || "").trim();

      const requestPayload = {
        seed: wallet.seed,
        poolId: poolAddress,
        poolAccount: poolOverrideAccount || poolAddress,
        tokenIn: tokenIn.address,
        tokenInSymbol: tokenIn.symbol,
        tokenOut: tokenOut.address,
        tokenOutSymbol: tokenOut.symbol,
        amountIn: amountInRaw.toString(),
        accountIndex: wallet.index || 0,
      };
      if (tokenOverrides && Object.keys(tokenOverrides).length > 0) {
        requestPayload.tokenAddresses = tokenOverrides;
      }

      const response = await fetch("/.netlify/functions/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Swap failed");
      }

      // ✅ Store both expectedRaw + amountFormatted so summary rows stay in sync
      setQuoteDetails({
        tokens: {
          from: {
            symbol: payload?.tokens?.from?.symbol,
            feePaidFormatted: payload?.tokens?.from?.feePaidFormatted,
          },
          to: {
            symbol: payload?.tokens?.to?.symbol,
            expectedFormatted: payload?.tokens?.to?.amountFormatted,
            expectedRaw: payload?.tokens?.to?.expectedRaw, // <-- keep raw for calc
            minimumFormatted: (() => {
              try {
                const outRaw = BigInt(payload?.tokens?.to?.expectedRaw || "0");
                if (outRaw <= 0n) return payload?.tokens?.to?.amountFormatted;
                const slippageMultiplier = BigInt(10_000 - slippageBps);
                const minOutRaw = (outRaw * slippageMultiplier) / 10_000n;
                return formatAmount(minOutRaw, tokenOut.decimals);
              } catch {
                return payload?.tokens?.to?.amountFormatted;
              }
            })(),
          },
        },
        priceImpact: payload?.priceImpact,
      });

      setStatus(payload?.message || "Swap prepared.");
      refresh();
    } catch (error) {
      setStatus(`Swap failed: ${error.message}`);
    }
  };

  const poolStatusMessage = poolError
    ? `Failed to load pool: ${poolError}`
    : poolLoading
    ? "Fetching pool state..."
    : "";

  const heroStats = useMemo(() => {
    if (!poolData?.tokens?.length) {
      return [
        { label: "Fee tier", value: "0 bps" },
        { label: "LP supply", value: "—" },
        { label: "Updated", value: "—" },
      ];
    }
    const [tokenA, tokenB] = poolData.tokens;
    return [
      { label: "Fee tier", value: `${poolData.pool.feeBps} bps` },
      {
        label: `${tokenA.symbol} reserve`,
        value: `${tokenA.reserveFormatted} ${tokenA.symbol}`,
      },
      {
        label: `${tokenB.symbol} reserve`,
        value: `${tokenB.reserveFormatted} ${tokenB.symbol}`,
      },
    ];
  }, [poolData]);

  const featuredPools = useMemo(() => {
    if (!poolData?.tokens?.length) {
      return [];
    }
    const [tokenA, tokenB] = poolData.tokens;
    return [
      {
        id: poolData.pool.address,
        tokenA: tokenA.symbol,
        tokenB: tokenB.symbol,
        fee: poolData.pool.feeBps,
        reserves: `${tokenA.reserveFormatted} ${tokenA.symbol} / ${tokenB.reserveFormatted} ${tokenB.symbol}`,
      },
    ];
  }, [poolData]);
  return (
    <main className="page" id="swap">
      <section className="hero-section">
        <div className="hero-grid">
          <div className="hero-content">
            <span className="eyebrow">Keeta Liquidity Layer</span>
            <h1 className="hero-heading">Swap at apex speed with Silverback.</h1>
            <p className="hero-subtitle">
              Deep liquidity, MEV-aware routing, and a premium trading experience built for the Keeta ecosystem.
            </p>
            <div className="hero-actions">
              <button
                type="button"
                className="primary-cta"
                onClick={() => onNavigate("swap", "/", "swap-panel")}
              >
                Start swapping
              </button>
              <button
                type="button"
                className="ghost-cta"
                onClick={() => onNavigate("pools", "/pools", "pools")}
              >
                View pools
              </button>
            </div>
            <div className="metric-row" id="stats">
              {heroStats.map((item) => (
                <div className="metric-card" key={item.label}>
                  <span className="metric-label">{item.label}</span>
                  <span className="metric-value">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="hero-panel" id="swap-panel">
            <WalletControls wallet={wallet} onWalletChange={onWalletChange} />
            <div className="swap-card swap-card--panel">
              <div className="swap-card__header">
                <div className="swap-card__summary">
                  <div className="swap-card__tabs" role="tablist" aria-label="Swap modes">
                    {[{ key: "swap", label: "Swap" }, { key: "limit", label: "Limit", disabled: true }, { key: "liquidity", label: "Liquidity", disabled: true }].map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        role="tab"
                        aria-selected={activeSwapTab === tab.key}
                        className={`swap-card__tab${activeSwapTab === tab.key ? " is-active" : ""}`}
                        onClick={() => {
                          if (!tab.disabled) {
                            setActiveSwapTab(tab.key);
                          }
                        }}
                        disabled={Boolean(tab.disabled)}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  <div className="swap-card__subtitle">Live Keeta pricing with one-tap execution.</div>
                </div>
                <div className="swap-card__popover">
                  <button
                    type="button"
                    className="slippage-chip"
                    aria-haspopup="dialog"
                    aria-expanded={slippageOpen}
                    onClick={() => setSlippageOpen((open) => !open)}
                  >
                    {slippagePercentDisplay}
                  </button>
                  {slippageOpen && (
                    <div className="slippage-popover" role="dialog" aria-label="Slippage settings">
                      <div className="slip-row">
                        {[10, 50, 100].map((bps) => (
                          <button
                            type="button"
                            key={bps}
                            className={`slip-btn${slippageBps === bps ? " is-active" : ""}`}
                            onClick={() => {
                              setSlippageBps(bps);
                              setSlippageOpen(false);
                            }}
                          >
                            {(bps / 100).toFixed(2)}%
                          </button>
                        ))}
                        <label className="slip-custom">
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={slippageBps}
                            inputMode="numeric"
                            onChange={(event) =>
                              setSlippageBps(Math.max(0, Math.floor(Number(event.target.value) || 0)))
                            }
                          />
                          <span>bps</span>
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="swap-card__body">
                <div className="swap-input-block">
                  <div className="swap-input-block__top">
                    <span className="swap-input-block__label">You pay</span>
                    <span className="swap-input-block__balance">
                      {walletLoading
                        ? "Balance: Loading..."
                        : walletBaseToken &&
                          symbolsEqual(fromAsset, walletBaseToken.symbol) &&
                          walletBaseTokenBalance != null
                        ? `Balance: ${walletBaseTokenBalance} ${walletBaseToken.symbol}`
                        : "Balance: —"}
                    </span>
                  </div>
                  <div className="swap-input">
                    <input
                      id="swap-from-amount"
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={fromAmount}
                      onChange={(event) => setFromAmount(event.target.value)}
                    />
                    <TokenSelect
                      value={fromToken}
                      onChange={handleFromTokenChange}
                      options={tokenOptions}
                    />
                  </div>
                  <div className="swap-input__caption">Pool price updates automatically</div>
                </div>

                <button
                  type="button"
                  className="swap-flip"
                  aria-label="Switch direction"
                  onClick={flipDirection}
                >
                  <SwapIcon />
                </button>

                <div className="swap-input-block">
                  <div className="swap-input-block__top">
                    <span className="swap-input-block__label">You receive</span>
                    <span className="swap-input-block__balance">
                      {walletBaseToken && symbolsEqual(toAsset, walletBaseToken.symbol)
                        ? walletLoading
                          ? "Balance: Loading..."
                          : walletBaseTokenBalance != null
                          ? `Balance: ${walletBaseTokenBalance} ${walletBaseToken.symbol}`
                          : "Balance: —"
                        : ""}
                    </span>
                  </div>
                  <div className="swap-input">
                    <input
                      id="swap-to-amount"
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={toAmount}
                      onChange={(event) => setToAmount(event.target.value)}
                    />
                    <TokenSelect
                      value={toToken}
                      onChange={handleToTokenChange}
                      options={tokenOptions}
                    />
                  </div>
                </div>

                <div className="swap-summary">
  <div className="swap-summary__row">
    <span>Expected output</span>
    <span>
      {quoteDetails?.tokens?.to?.expectedFormatted || "—"}{" "}
      {quoteDetails?.tokens?.to?.symbol || toAsset}
    </span>
  </div>
  <div className="swap-summary__row">
    <span>
      Minimum received{" "}
      {slippagePercentDisplay ? `(${slippagePercentDisplay})` : ""}
    </span>
    <span>
      {quoteDetails?.tokens?.to?.minimumFormatted || "—"}{" "}
      {quoteDetails?.tokens?.to?.symbol || toAsset}
    </span>
  </div>
  <div className="swap-summary__row">
    <span>Fee</span>
    <span>
      {quoteDetails?.tokens?.from?.feePaidFormatted ||
        `${(poolData?.pool?.feeBps ?? 0) / 100}%`}{" "}
      {quoteDetails?.tokens?.from?.symbol || fromAsset}
    </span>
  </div>
  <div className="swap-summary__row">
    <span>Price impact</span>
    <span>{quoteDetails ? `${quoteDetails.priceImpact} %` : "—"}</span>
  </div>
  <div className="swap-summary__row route-line">
    <span>Route</span>
    <span>
      {poolData?.pool?.address ? formatAddress(poolData.pool.address) : "—"}
    </span>
  </div>
</div>

                {poolStatusMessage && <div className="swap-alert">{poolStatusMessage}</div>}

                <button type="button" className="primary-cta full swap-submit" onClick={handleSwap}>
                  Swap
                </button>

                {status && <p className="status swap-status">{status}</p>}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="market-section">
        <div className="section-header">
          <div>
            <span className="eyebrow">Featured markets</span>
            <h2>Discover deep liquidity pairs</h2>
            <p className="section-subtitle">
              Deploy capital into the highest performing pools backed by Silverback routing.
            </p>
          </div>
          <button
            type="button"
            className="ghost-cta"
            onClick={() => onNavigate("pools", "/pools", "pools")}
          >
            Explore pools
          </button>
        </div>
        <div className="pool-grid">
          {featuredPools.length === 0 && (
            <article className="pool-card" key="placeholder">
              <div className="pool-card-head">
                <div className="pool-token-icons">
                  <span className="token-icon token-icon-lg">
                    <TokenBadge symbol="KTA" />
                  </span>
                  <span className="token-icon token-icon-lg">
                    <TokenBadge symbol="TEST" />
                  </span>
                </div>
                <span className="pool-pair">KTA/TEST</span>
              </div>
              <div className="pool-card-body">
                <div className="pool-metric">
                  <span className="metric-label">Fee</span>
                  <span className="metric-value">—</span>
                </div>
                <div className="pool-metric">
                  <span className="metric-label">Reserves</span>
                  <span className="metric-value">—</span>
                </div>
              </div>
              <button
                type="button"
                className="pill-link"
                onClick={() => onNavigate("pools", "/pools", "pools")}
              >
                Manage position <ArrowTopRight />
              </button>
            </article>
          )}
          {featuredPools.map((pool) => (
            <article className="pool-card" key={pool.id}>
              <div className="pool-card-head">
                <div className="pool-token-icons">
                  <span className="token-icon token-icon-lg">
                    <TokenBadge symbol={pool.tokenA} />
                  </span>
                  <span className="token-icon token-icon-lg">
                    <TokenBadge symbol={pool.tokenB} />
                  </span>
                </div>
                <span className="pool-pair">{pool.tokenA}/{pool.tokenB}</span>
              </div>
              <div className="pool-card-body">
                <div className="pool-metric">
                  <span className="metric-label">Fee</span>
                  <span className="metric-value">{pool.fee} bps</span>
                </div>
                <div className="pool-metric">
                  <span className="metric-label">Reserves</span>
                  <span className="metric-value">{pool.reserves}</span>
                </div>
              </div>
              <button
                type="button"
                className="pill-link"
                onClick={() => onNavigate("pools", "/pools", "pools")}
              >
                Manage position <ArrowTopRight />
              </button>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
function PoolsPage({ wallet, onWalletChange, poolState }) {
  const {
    data: poolData,
    loading: poolLoading,
    error: poolError,
    refresh,
    overrides: poolOverrides,
  } = poolState;

  const walletBaseToken = wallet?.baseToken || null;
  const walletLoading = Boolean(wallet?.loading);
  const walletBaseTokenBalance = resolveBaseTokenBalance(walletBaseToken);

  const [amountA, setAmountA] = useState("");
  const [amountB, setAmountB] = useState("");
  const [lpAmount, setLpAmount] = useState("");
  const [addStatus, setAddStatus] = useState("");
  const [removeStatus, setRemoveStatus] = useState("");
  const [liquidityMode, setLiquidityMode] = useState("add");
  const [mintPreview, setMintPreview] = useState(null);
  const [withdrawPreview, setWithdrawPreview] = useState(null);
  const [tokenAAddressInput, setTokenAAddressInput] = useState("");
  const [tokenBAddressInput, setTokenBAddressInput] = useState("");
  const [tokenBSelection, setTokenBSelection] = useState("SBCK");
  const [tokenConfigStatus, setTokenConfigStatus] = useState("");
  const [poolAccountInput, setPoolAccountInput] = useState("");
  const [lpTokenAccountInput, setLpTokenAccountInput] = useState("");
  const [poolConfigStatus, setPoolConfigStatus] = useState("");
  const autoTokenStatusRef = useRef("");

  useEffect(() => {
    setPoolAccountInput(poolOverrides?.poolAccount || "");
    setLpTokenAccountInput(poolOverrides?.lpTokenAccount || "");
    setPoolConfigStatus("");
  }, [poolOverrides?.poolAccount, poolOverrides?.lpTokenAccount]);

  const tokensInPool = useMemo(() => {
    if (!poolData) {
      return [];
    }
    const tokens = [...(poolData.tokens || [])].map(withTokenLogo);
    if (poolData.baseToken?.symbol) {
      const key = poolData.baseToken.symbol;
      const exists = tokens.some((token) => token.symbol === key);
      if (!exists) {
        const reserve = poolData.reserves?.[key];
        tokens.unshift(
          withTokenLogo({
            ...poolData.baseToken,
            reserveRaw: reserve?.reserveRaw || poolData.baseToken.reserveRaw || "0",
            reserveFormatted:
              reserve?.reserveFormatted || poolData.baseToken.reserveFormatted || "0",
          })
        );
      }
    }
    return tokens;
  }, [poolData]);
  const tokenA = tokensInPool[0];
  const defaultTokenB = tokensInPool[1];
  const missingTokenSymbols = useMemo(() => {
    if (!poolData?.tokens) {
      return [];
    }
    return poolData.tokens
      .filter((token) => token?.requiresConfiguration)
      .map((token) => token.symbol)
      .filter(Boolean);
  }, [poolData?.tokens]);
  const tokenB = useMemo(() => {
    if (!tokensInPool.length) {
      return undefined;
    }
    if (!tokenBSelection) {
      return defaultTokenB;
    }
    return tokensInPool.find((token) => token.symbol === tokenBSelection) || defaultTokenB;
  }, [tokensInPool, tokenBSelection, defaultTokenB]);
  const lpToken = poolData?.lpToken;

  const balanceA = useMemo(() => {
    if (!tokenA?.symbol || !walletBaseToken?.symbol) {
      return "";
    }
    if (!symbolsEqual(tokenA.symbol, walletBaseToken.symbol)) {
      return "";
    }
    if (walletLoading) {
      return "Balance: Loading...";
    }
    if (walletBaseTokenBalance != null) {
      return `Balance: ${walletBaseTokenBalance} ${walletBaseToken.symbol}`;
    }
    return "Balance: —";
  }, [tokenA?.symbol, walletBaseToken, walletLoading, walletBaseTokenBalance]);

  const balanceB = useMemo(() => {
    if (!tokenB?.symbol || !walletBaseToken?.symbol) {
      return "";
    }
    if (!symbolsEqual(tokenB.symbol, walletBaseToken.symbol)) {
      return "";
    }
    if (walletLoading) {
      return "Balance: Loading...";
    }
    if (walletBaseTokenBalance != null) {
      return `Balance: ${walletBaseTokenBalance} ${walletBaseToken.symbol}`;
    }
    return "Balance: —";
  }, [tokenB?.symbol, walletBaseToken, walletLoading, walletBaseTokenBalance]);

  const canAdd = useMemo(() => {
    if (!tokenA?.symbol || !tokenB?.symbol) {
      return false;
    }
    if (tokenA?.requiresConfiguration || tokenB?.requiresConfiguration) {
      return false;
    }
    const valueA = parseFloat(amountA);
    const valueB = parseFloat(amountB);
    if (!Number.isFinite(valueA) || !Number.isFinite(valueB)) {
      return false;
    }
    return valueA > 0 && valueB > 0;
  }, [
    amountA,
    amountB,
    tokenA?.symbol,
    tokenB?.symbol,
    tokenA?.requiresConfiguration,
    tokenB?.requiresConfiguration,
  ]);

  const canRemove = useMemo(() => {
    const value = parseFloat(lpAmount);
    return Number.isFinite(value) && value > 0;
  }, [lpAmount]);

  const addStatusMessage = addStatus || tokenConfigStatus;

  const handleLiquidityModeChange = useCallback(
    (mode) => {
      setLiquidityMode(mode);
      if (mode === "add") {
        setRemoveStatus("");
      } else {
        setAddStatus("");
      }
    },
    [setAddStatus, setRemoveStatus]
  );

  useEffect(() => {
    if (!tokenA?.symbol) {
      setTokenAAddressInput("");
      return;
    }
    const symbolKey = tokenA.symbol.toUpperCase();
    const overrideAddress =
      poolOverrides?.tokenAddresses?.[symbolKey] ||
      poolOverrides?.tokenAddresses?.[tokenA.symbol];
    const next = overrideAddress || tokenA?.address || "";
    setTokenAAddressInput(next);
  }, [tokenA?.symbol, tokenA?.address, poolOverrides?.tokenAddresses]);

  useEffect(() => {
    setLiquidityMode("add");
    setRemoveStatus("");
    setAddStatus("");
    setTokenConfigStatus("");
  }, [tokenA?.symbol, tokenB?.symbol]);

  useEffect(() => {
    if (!poolData?.requiresTokenConfiguration) {
      if (autoTokenStatusRef.current && tokenConfigStatus === autoTokenStatusRef.current) {
        setTokenConfigStatus("");
      }
      autoTokenStatusRef.current = "";
      return;
    }

    const symbols = missingTokenSymbols;
    let message = "";
    if (symbols.length === 0) {
      message = "Enter token contract addresses to finish configuring this pool.";
    } else if (symbols.length === 1) {
      message = `Enter the contract address for ${symbols[0]} to finish configuring this pool.`;
    } else if (symbols.length === 2) {
      message = `Enter the contract addresses for ${symbols[0]} and ${symbols[1]} to finish configuring this pool.`;
    } else {
      const [first, second, ...rest] = symbols;
      const trailing = rest.slice(0, -1).join(", ");
      const last = rest[rest.length - 1];
      const middle = trailing ? `${second}, ${trailing}` : second;
      message = `Enter the contract addresses for ${first}, ${middle}, and ${last} to finish configuring this pool.`;
    }

    setTokenConfigStatus((prev) => {
      if (prev && prev !== autoTokenStatusRef.current) {
        return prev;
      }
      autoTokenStatusRef.current = message;
      return message;
    });
  }, [
    poolData?.requiresTokenConfiguration,
    missingTokenSymbols,
    tokenConfigStatus,
    setTokenConfigStatus,
  ]);

  const baseToken = poolData?.baseToken;

  const tokenConfigOptions = useMemo(() => {
    if (!poolData) {
      return [];
    }
    const seen = new Set();
    const tokens = [];
    for (const token of poolData.tokens || []) {
      if (!token?.symbol) continue;
      const key = token.symbol.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tokens.push(token);
    }
    if (poolData.baseToken?.symbol) {
      const key = poolData.baseToken.symbol.toUpperCase();
      if (!seen.has(key)) {
        seen.add(key);
        tokens.push(poolData.baseToken);
      }
    }
    return tokens.map((token) => ({
      symbol: token.symbol,
      name: formatAddress(token.address),
      address: token.address,
    }));
  }, [poolData]);

  useEffect(() => {
    const fallbackSymbol = tokenB?.symbol || tokenBSelection || baseToken?.symbol || "";
    const symbolKey = fallbackSymbol ? fallbackSymbol.toUpperCase() : "";
    const overrideAddress =
      (symbolKey && poolOverrides?.tokenAddresses?.[symbolKey]) ||
      (fallbackSymbol && poolOverrides?.tokenAddresses?.[fallbackSymbol]);
    const fallbackOption = tokenConfigOptions.find((item) => item.symbol === fallbackSymbol);
    const fallbackAddress =
      tokenB?.address || fallbackOption?.address || baseToken?.address || "";
    const nextAddress = overrideAddress || fallbackAddress || "";
    setTokenBAddressInput(nextAddress);
    setTokenBSelection((prev) => (prev ? prev : fallbackSymbol));
  }, [
    tokenB?.address,
    tokenB?.symbol,
    tokenConfigOptions,
    tokenBSelection,
    baseToken?.address,
    baseToken?.symbol,
    poolOverrides?.tokenAddresses,
  ]);

  const handleApplyTokenConfig = useCallback(async () => {
    setAddStatus("");
    if (!tokenA && !tokenB && !tokenBSelection) {
      setTokenConfigStatus("Load pool data before configuring tokens");
      return;
    }
    const overrides = {};
    if (tokenA?.symbol && tokenAAddressInput.trim()) {
      overrides[tokenA.symbol] = tokenAAddressInput.trim();
    }
    const selectionSymbol = (tokenBSelection || tokenB?.symbol || "").trim();
    if (selectionSymbol && tokenBAddressInput.trim()) {
      overrides[selectionSymbol] = tokenBAddressInput.trim();
    }
    if (!Object.keys(overrides).length) {
      setTokenConfigStatus("Enter token contract addresses to update the pool mapping");
      return;
    }
    setTokenConfigStatus("Updating token mapping...");
    const success = await refresh({ tokenAddresses: overrides });
    if (success === false) {
      setTokenConfigStatus("Failed to update tokens. Check the contract addresses and try again.");
    } else {
      setTokenConfigStatus("Token mapping updated");
    }
  }, [
    refresh,
    tokenA,
    tokenB,
    tokenAAddressInput,
    tokenBAddressInput,
    tokenBSelection,
    setAddStatus,
  ]);

  const handleApplyPoolConfig = useCallback(async () => {
    const trimmedPool = (poolAccountInput || "").trim();
    const trimmedLp = (lpTokenAccountInput || "").trim();
    const currentPool = (poolOverrides?.poolAccount || "").trim();
    const currentLp = (poolOverrides?.lpTokenAccount || "").trim();
    if (trimmedPool === currentPool && trimmedLp === currentLp) {
      setPoolConfigStatus("Pool configuration already up to date");
      return;
    }
    const hasValues = Boolean(trimmedPool || trimmedLp);
    setPoolConfigStatus(hasValues ? "Updating pool configuration..." : "Clearing pool overrides...");
    const success = await refresh({
      poolAccount: trimmedPool,
      lpTokenAccount: trimmedLp,
    });
    if (success === false) {
      setPoolConfigStatus(
        "Failed to update pool configuration. Check the addresses and try again."
      );
    } else {
      setPoolConfigStatus("Pool configuration updated");
    }
  }, [
    poolAccountInput,
    lpTokenAccountInput,
    poolOverrides?.poolAccount,
    poolOverrides?.lpTokenAccount,
    refresh,
  ]);

  useEffect(() => {
    if (
      !poolData ||
      !tokenA ||
      !tokenB ||
      tokenA?.requiresConfiguration ||
      tokenB?.requiresConfiguration
    ) {
      setMintPreview(null);
      return;
    }
    try {
      const rawA = toRawAmount(amountA, tokenA.decimals);
      const rawB = toRawAmount(amountB, tokenB.decimals);
      if (rawA <= 0n || rawB <= 0n) {
        setMintPreview(null);
        return;
      }
      const preview = calculateLiquidityQuote(
        rawA,
        rawB,
        BigInt(tokenA.reserveRaw),
        BigInt(tokenB.reserveRaw),
        BigInt(lpToken.supplyRaw)
      );
      setMintPreview({
        minted: preview.minted,
        share: preview.share,
        formatted: formatAmount(preview.minted, lpToken.decimals),
      });
    } catch (error) {
      setMintPreview(null);
    }
  }, [
    amountA,
    amountB,
    poolData,
    tokenA,
    tokenB,
    lpToken,
    tokenA?.requiresConfiguration,
    tokenB?.requiresConfiguration,
  ]);

  useEffect(() => {
    if (
      !poolData ||
      !tokenA ||
      !tokenB ||
      tokenA?.requiresConfiguration ||
      tokenB?.requiresConfiguration
    ) {
      setWithdrawPreview(null);
      return;
    }
    try {
      const rawLp = toRawAmount(lpAmount, lpToken.decimals);
      if (rawLp <= 0n) {
        setWithdrawPreview(null);
        return;
      }
      const preview = calculateWithdrawalQuote(
        rawLp,
        BigInt(tokenA.reserveRaw),
        BigInt(tokenB.reserveRaw),
        BigInt(lpToken.supplyRaw)
      );
      setWithdrawPreview({
        amountA: preview.amountA,
        amountB: preview.amountB,
        share: preview.share,
        formattedA: formatAmount(preview.amountA, tokenA.decimals),
        formattedB: formatAmount(preview.amountB, tokenB.decimals),
      });
    } catch (error) {
      setWithdrawPreview(null);
    }
  }, [
    lpAmount,
    poolData,
    tokenA,
    tokenB,
    lpToken,
    tokenA?.requiresConfiguration,
    tokenB?.requiresConfiguration,
  ]);

  const handleAddLiquidity = async () => {
    if (!tokenA?.symbol || !tokenB?.symbol) {
      setAddStatus("Select both tokens before adding liquidity");
      return;
    }
    if (tokenA?.requiresConfiguration || tokenB?.requiresConfiguration) {
      setAddStatus("Configure token contract addresses before adding liquidity");
      return;
    }
    if (!wallet?.seed) {
      setAddStatus("Connect a testnet wallet seed first");
      return;
    }
    if (!amountA || !amountB) {
      setAddStatus("Enter both token amounts");
      return;
    }
    setAddStatus("Submitting liquidity...");
    try {
      const tokenASymbol = tokenA.symbol;
      const tokenBSymbol = tokenB.symbol;
      const tokenOverrides = poolOverrides?.tokenAddresses
        ? { ...poolOverrides.tokenAddresses }
        : {};
      const tokenAAddressValue = (tokenAAddressInput || tokenA?.address || "").trim();
      const tokenBAddressValue = (tokenBAddressInput || tokenB?.address || "").trim();
      if (tokenAAddressValue) {
        tokenOverrides[tokenASymbol] = tokenAAddressValue;
      }
      if (tokenBAddressValue) {
        tokenOverrides[tokenBSymbol] = tokenBAddressValue;
      }
      const response = await fetch("/.netlify/functions/addLiquidity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenA: tokenASymbol,
          tokenB: tokenBSymbol,
          amountA,
          amountB,
          seed: wallet.seed,
          accountIndex: wallet.index || 0,
          tokenAddresses: tokenOverrides,
          tokenAAddress: tokenAAddressValue,
          tokenBAddress: tokenBAddressValue,
          poolAccount: poolOverrides?.poolAccount || "",
          lpTokenAccount: poolOverrides?.lpTokenAccount || "",
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Add liquidity failed");
      }
      setAddStatus(
        `Liquidity prepared: mint ${payload.minted.formatted} ${lpToken.symbol}. ${payload.message}`
      );
      refresh();
    } catch (error) {
      setAddStatus(`Add liquidity failed: ${error.message}`);
    }
  };

  const handleRemoveLiquidity = async () => {
    if (!wallet?.seed) {
      setRemoveStatus("Connect a testnet wallet seed first");
      return;
    }
    if (!lpAmount) {
      setRemoveStatus("Enter an LP amount to withdraw");
      return;
    }
    setRemoveStatus("Submitting withdrawal...");
    try {
      const tokenOverrides = poolOverrides?.tokenAddresses
        ? { ...poolOverrides.tokenAddresses }
        : {};
      const tokenAAddressValue = (tokenAAddressInput || tokenA?.address || "").trim();
      const tokenBAddressValue = (tokenBAddressInput || tokenB?.address || "").trim();
      if (tokenA?.symbol && tokenAAddressValue) {
        tokenOverrides[tokenA.symbol] = tokenAAddressValue;
      }
      if (tokenB?.symbol && tokenBAddressValue) {
        tokenOverrides[tokenB.symbol] = tokenBAddressValue;
      }
      const response = await fetch("/.netlify/functions/removeLiquidity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenA: tokenA.symbol,
          tokenB: tokenB.symbol,
          lpAmount,
          seed: wallet.seed,
          accountIndex: wallet.index || 0,
          tokenAddresses: tokenOverrides,
          tokenAAddress: tokenAAddressValue,
          tokenBAddress: tokenBAddressValue,
          poolAccount: poolOverrides?.poolAccount || "",
          lpTokenAccount: poolOverrides?.lpTokenAccount || "",
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Remove liquidity failed");
      }
      setRemoveStatus(
        `Withdrawal prepared: ${payload.withdrawals.tokenA.amountFormatted} ${tokenA.symbol} + ${payload.withdrawals.tokenB.amountFormatted} ${tokenB.symbol}. ${payload.message}`
      );
      refresh();
    } catch (error) {
      setRemoveStatus(`Remove liquidity failed: ${error.message}`);
    }
  };
  return (
    <main className="page pools-page" id="pools">
      <section className="pools-hero">
        <div className="hero-content">
          <span className="eyebrow">Liquidity Network</span>
          <h1 className="hero-heading">Deploy liquidity with confidence.</h1>
          <p className="hero-subtitle">
            Choose high performing pools, monitor reserves in real-time, and manage LP tokens from a single dashboard.
          </p>
        </div>
      </section>

      <section className="pools-layout-section">
        <div className="pools-layout">
          <aside className="pool-selector">
            <h2 className="section-title">Available Pools</h2>
            {poolLoading && <p className="status">Fetching pool data...</p>}
            {poolError && <p className="status">Failed to load pool: {poolError}</p>}
            {!poolLoading && !poolError && tokenA && tokenB && (
              <div className="pool-selector-list">
                <button type="button" className="pool-selector-card is-active">
                  <div className="pool-card-head">
                    <div className="pool-token-icons">
                      <span className="token-icon">
                        <TokenBadge symbol={tokenA.symbol} />
                      </span>
                      <span className="token-icon">
                        <TokenBadge symbol={tokenB.symbol} />
                      </span>
                    </div>
                    <span className="pool-pair">{tokenA.symbol}/{tokenB.symbol}</span>
                  </div>
                  <div className="pool-card-body">
                    <div className="pool-metric">
                      <span className="metric-label">Fee tier</span>
                      <span className="metric-value">{poolData.pool.feeBps} bps</span>
                    </div>
                    <div className="pool-metric">
                      <span className="metric-label">LP supply</span>
                      <span className="metric-value">{lpToken.supplyFormatted}</span>
                    </div>
                  </div>
                </button>
              </div>
            )}
          </aside>

          <div className="pool-detail">
            <div className="swap-card pool-overview">
              <div className="swap-card-header">
                <div className="swap-card-title">
                  <h2>
                    {tokenA?.symbol}/{tokenB?.symbol}
                  </h2>
                  <span className="swap-chip">Pool overview</span>
                </div>
              </div>
              {poolLoading ? (
                <p className="status">Fetching reserves...</p>
              ) : poolError ? (
                <p className="status">{poolError}</p>
              ) : tokenA && tokenB ? (
                <div className="info-rows">
                  <div className="info-line">
                    Reserves: {tokenA.reserveFormatted} {tokenA.symbol} / {tokenB.reserveFormatted} {tokenB.symbol}
                  </div>
                  <div className="info-line">
                    LP supply: {lpToken.supplyFormatted} {lpToken.symbol}
                  </div>
                  <div className="info-line">
                    Pool address: {formatAddress(poolData.pool.address)}
                  </div>
                  <div className="info-line">
                    Fee tier: {poolData.pool.feeBps} bps
                  </div>
                </div>
              ) : (
                <p className="status">Pool unavailable</p>
              )}
            </div>

            <div className="swap-card pool-config-card">
              <div className="swap-card-header">
                <div className="swap-card-title">
                  <h2>Pool configuration</h2>
                  <span className="swap-chip">Keeta testnet</span>
                </div>
              </div>
              <p className="config-hint">
                Provide the pool and LP token accounts for the KTA/RIDE pair. The RIDE token override defaults to
                {" "}
                {formatAddress(RIDE_TOKEN_ADDRESS)}.
              </p>
              <div className="field-group">
                <span className="field-label">Pool account</span>
                <input
                  value={poolAccountInput}
                  onChange={(event) => {
                    setPoolAccountInput(event.target.value);
                    setPoolConfigStatus("");
                  }}
                  placeholder="Enter pool contract"
                  type="text"
                  spellCheck={false}
                />
              </div>
              <div className="field-group">
                <span className="field-label">LP token account</span>
                <input
                  value={lpTokenAccountInput}
                  onChange={(event) => {
                    setLpTokenAccountInput(event.target.value);
                    setPoolConfigStatus("");
                  }}
                  placeholder="Enter LP token contract"
                  type="text"
                  spellCheck={false}
                />
              </div>
              <div className="field-group">
                <button type="button" className="ghost-cta full" onClick={handleApplyPoolConfig}>
                  Apply pool accounts
                </button>
              </div>
              {poolConfigStatus && <p className="status">{poolConfigStatus}</p>}
            </div>

            <div className="dual-card">
              <LiquidityCard
                key={`${tokenA?.symbol || ""}-${tokenB?.symbol || ""}`}
                mode={liquidityMode}
                onModeChange={handleLiquidityModeChange}
                tokenA={tokenA}
                tokenB={tokenB}
                lpToken={lpToken}
                tokenAAddress={tokenAAddressInput}
                tokenBAddress={tokenBAddressInput}
                onChangeTokenAAddress={(value) => {
                  setTokenAAddressInput(value);
                  setTokenConfigStatus("");
                }}
                onChangeTokenBAddress={(value) => {
                  setTokenBAddressInput(value);
                  setTokenConfigStatus("");
                }}
                onApplyTokenAddresses={handleApplyTokenConfig}
                amountA={amountA}
                amountB={amountB}
                onChangeAmountA={setAmountA}
                onChangeAmountB={setAmountB}
                lpAmount={lpAmount}
                onChangeLpAmount={setLpAmount}
                balanceA={balanceA}
                balanceB={balanceB}
                mintPreview={mintPreview}
                withdrawPreview={withdrawPreview}
                addStatus={addStatusMessage}
                removeStatus={removeStatus}
                canAdd={canAdd}
                canRemove={canRemove}
                onAddLiquidity={handleAddLiquidity}
                onRemoveLiquidity={handleRemoveLiquidity}
              />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
function App() {
  const [view, setView] = useState(() =>
    typeof window !== "undefined" && window.location.pathname.toLowerCase().includes("pools")
      ? "pools"
      : "swap"
  );

  const [wallet, setWallet] = useState(() => ({ ...INITIAL_WALLET_STATE }));
  const poolState = usePoolState();
  const walletSeed = wallet.seed;
  const walletIndex = wallet.index;
  const walletAddress = wallet.address;
  const walletAccount = wallet.account;
  const walletAccountKey = (() => {
    try {
      return walletAccount?.publicKeyString?.get?.() || null;
    } catch (error) {
      return null;
    }
  })();

  const scrollToSection = useCallback((id) => {
    if (typeof window === "undefined") return;
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  }, []);

  useEffect(() => {
    applyBrandTheme(BRAND_LOGO).catch(() => {
      /* ignore theme errors */
    });
  }, []);

  useEffect(() => {
    const handlePop = () => {
      const next = window.location.pathname.toLowerCase().includes("pools") ? "pools" : "swap";
      setView(next);
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

  const handleNavigate = useCallback(
    (target, path, scrollTarget) => {
      if (typeof window !== "undefined") {
        if (window.location.pathname !== path) {
          window.history.pushState({}, "", path);
        }
        setView(target);
        if (scrollTarget) {
          setTimeout(() => {
            scrollToSection(scrollTarget);
          }, 50);
        }
      }
    },
    [scrollToSection]
  );

  const handleWalletChange = useCallback(
    (next) => {
      setWallet((prev) => ({ ...prev, ...next }));
    },
    []
  );

  const handleConnectClick = useCallback(() => {
    scrollToSection("wallet-panel");
  }, [scrollToSection]);

  useEffect(() => {
    let cancelled = false;
    const loadBalances = async () => {
      if (!walletSeed || !walletAddress) {
        setWallet((prev) => {
          if (
            (!prev.balances || prev.balances.length === 0) &&
            !prev.balanceLoading &&
            !prev.balanceError
          ) {
            return prev;
          }
          return {
            ...prev,
            balances: [],
            balanceError: "",
            balanceLoading: false,
          };
        });
        return;
      }
    setWallet((prev) => ({
      ...prev,
      balanceLoading: true,
      balanceError: "",
    }));
    let client;
    try {
      let account = walletAccount;
      if (!account) {
        account = KeetaLib.Account.fromSeed(walletSeed, walletIndex || 0);
      }
      client = await createKeetaClient(account);
      let accountInfo;
      try {
        accountInfo = await client.client.getAccountInfo(
          account.publicKeyString.get()
        );
      } catch (infoError) {
        accountInfo = await client.client.getAccountInfo(account);
      }
      const balances = Array.isArray(accountInfo?.balances) ? accountInfo.balances : [];
      const normalized = balances.map((entry, index) => {
        const raw = entry?.balance ?? entry?.amount ?? entry?.raw ?? 0;
        const { address, label } = resolveBalanceMetadata(entry, index);
        const uniqueKey = address || `${label}-${index}`;
        return {
          ...entry,
          accountId: address,
          accountLabel: label,
          balanceKey: uniqueKey,
          formatted: formatKeetaBalance(raw),
        };
      });
      if (!cancelled) {
        setWallet((prev) => ({
          ...prev,
          account,
          balances: normalized,
          balanceLoading: false,
          balanceError: "",
        }));
      }
    } catch (error) {
      if (!cancelled) {
        setWallet((prev) => ({
          ...prev,
          balances: [],
          balanceLoading: false,
          balanceError: error?.message || "Failed to load balances",
        }));
      }
    } finally {
      if (client && typeof client.destroy === "function") {
        try {
          await client.destroy();
        } catch (destroyError) {
          // eslint-disable-next-line no-console
          console.warn("Failed to destroy wallet client", destroyError);
        }
      }
    }
  };

  loadBalances();

    return () => {
      cancelled = true;
    };
  }, [walletSeed, walletIndex, walletAddress, walletAccountKey, walletAccount]);

  return (
    <div className="app">
      <div className="site-shell">
        <Header view={view} onNavigate={handleNavigate} wallet={wallet} onConnectClick={handleConnectClick} />
        {view === "pools" ? (
          <PoolsPage wallet={wallet} onWalletChange={handleWalletChange} poolState={poolState} />
        ) : (
          <SwapPage
            wallet={wallet}
            onWalletChange={handleWalletChange}
            onNavigate={handleNavigate}
            poolState={poolState}
          />
        )}
        <Footer onNavigate={handleNavigate} />
      </div>
    </div>
  );
}

export default App;
