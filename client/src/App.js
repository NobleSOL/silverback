/* global BigInt */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { lib as KeetaLib } from "@keetanetwork/keetanet-client";
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

/* --- trimmed constants (BRAND_LOGO, TOKEN_ICON_PATHS, etc.) --- */

/** Initial wallet state */
const INITIAL_WALLET_STATE = {
  seed: "",
  index: 0,
  address: "",
  account: null,
  baseToken: {
    symbol: "KTA",
    balanceRaw: "0",
    balanceFormatted: "0",
  },
  error: "",
  loading: false,
};

function formatAddress(address) {
  if (!address) return "";
  if (address.length <= 12) return address;
  return `${address.slice(0, 10)}…${address.slice(-6)}`;
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

/** Wallet panel */
function WalletControls({ wallet, onWalletChange }) {
  const [seedInput, setSeedInput] = useState(wallet.seed || "");
  const [indexInput, setIndexInput] = useState(wallet.index || 0);
  const [status, setStatus] = useState("");

  useEffect(() => {
    setSeedInput(wallet.seed || "");
    setIndexInput(wallet.index || 0);
  }, [wallet.seed, wallet.index]);

  const baseTokenBalance = resolveBaseTokenBalance(wallet.baseToken);
  const walletLoading = Boolean(wallet.loading);

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
      if (!trimmed) throw new Error("Provide a 64-character hex seed");
      if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) throw new Error("Invalid seed format");

      setStatus("Connecting...");
      onWalletChange({ ...INITIAL_WALLET_STATE, seed: trimmed, index, loading: true });

      const response = await fetch("/.netlify/functions/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seed: trimmed, accountIndex: index }),
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to load wallet");

      onWalletChange({
        ...INITIAL_WALLET_STATE,
        seed: trimmed,
        index,
        address: payload.address,
        baseToken: payload.baseToken,
        error: "",
        loading: false,
      });

      setStatus(`Connected ${formatAddress(payload.address)}`);
    } catch (error) {
      onWalletChange({
        ...INITIAL_WALLET_STATE,
        seed: trimmed,
        index,
        error: error.message,
        loading: false,
      });
      setStatus(error.message);
    }
  };

  return (
    <div className="swap-card wallet-card" id="wallet-panel">
      <div className="swap-card-header">
        <h2>Wallet</h2>
      </div>
      <div className="field-group">
        <label>Seed</label>
        <input
          type="text"
          value={seedInput}
          onChange={(e) => setSeedInput(e.target.value)}
          placeholder="64-character hex seed"
        />
      </div>
      <div className="field-group">
        <label>Account index</label>
        <input
          type="number"
          min="0"
          value={indexInput}
          onChange={(e) => setIndexInput(Number(e.target.value) || 0)}
        />
      </div>
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
          {walletLoading ? "Connecting..." : wallet.address ? "Reconnect" : "Connect"}
        </button>
      </div>
      {wallet.address && (
        <div className="info-line">
          Address: <code>{wallet.address}</code>
        </div>
      )}
      {wallet.baseToken && (
        <div className="info-line">
          Balance:{" "}
          {walletLoading
            ? "Loading..."
            : baseTokenBalance != null
            ? `${baseTokenBalance} ${wallet.baseToken.symbol}`
            : "—"}
        </div>
      )}
      {status && <p className="status">{status}</p>}
    </div>
  );
}

/* --- keep your SwapPage, PoolsPage, Header, Footer code as-is --- */

function App() {
  const [view, setView] = useState("swap");
  const [wallet, setWallet] = useState(() => ({ ...INITIAL_WALLET_STATE }));

  useEffect(() => {
    applyBrandTheme().catch(() => {});
  }, []);

  const handleWalletChange = useCallback(
    (next) => {
      setWallet((prev) => ({ ...prev, ...next }));
    },
    []
  );

  const handleConnectClick = useCallback(() => {
    const element = document.getElementById("wallet-panel");
    if (element) element.scrollIntoView({ behavior: "smooth" });
  }, []);

  return (
    <div className="app">
      {/* Header with connect button */}
      {/* SwapPage and PoolsPage */}
      {/* Footer */}
      <WalletControls wallet={wallet} onWalletChange={handleWalletChange} />
    </div>
  );
}

export default App;
