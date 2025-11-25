import { useState, useMemo } from "react";
import TokenLogo from "@/components/shared/TokenLogo";

export interface KeetaToken {
  address: string;
  symbol: string;
  balance: string;
  balanceFormatted: string;
  decimals: number;
  logoUrl?: string;
}

// KTA logo URL (using Keeta logo)
const KTA_LOGO = "https://raw.githubusercontent.com/keeta-network/brand/main/logo-dark.svg";

export default function KeetaTokenSelector({
  open,
  onClose,
  onSelect,
  tokens,
  excludeAddress,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (token: KeetaToken) => void;
  tokens: KeetaToken[];
  excludeAddress?: string;
}) {
  const [query, setQuery] = useState("");

  // Helper to get token logo (use Keeta logo for KTA)
  const getTokenLogo = (token: KeetaToken) => {
    if (token.symbol === "KTA") return KTA_LOGO;
    return token.logoUrl;
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const available = excludeAddress
      ? tokens.filter((t) => t.address !== excludeAddress)
      : tokens;

    if (!q) return available;

    return available.filter(
      (t) =>
        t.symbol.toLowerCase().includes(q) ||
        t.address.toLowerCase().includes(q)
    );
  }, [tokens, query, excludeAddress]);

  const [recent, setRecent] = useState<KeetaToken[]>(() => {
    try {
      const raw = localStorage.getItem("recentKeetaTokens");
      return raw ? (JSON.parse(raw) as KeetaToken[]) : [];
    } catch {
      return [];
    }
  });

  const saveRecent = (t: KeetaToken) => {
    const map = new Map<string, KeetaToken>();
    [t, ...recent].forEach((x) => map.set(x.address.toLowerCase(), x));
    const arr = Array.from(map.values()).slice(0, 8);
    setRecent(arr);
    try {
      localStorage.setItem("recentKeetaTokens", JSON.stringify(arr));
    } catch {}
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-border/60 bg-card p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Select a token</h3>
          <button
            className="text-sm text-muted-foreground hover:text-foreground"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or paste address"
          className="mb-3 w-full rounded-lg border border-border/60 bg-secondary/60 px-3 py-2 outline-none placeholder:text-muted-foreground/60"
        />

        {!query && recent.length > 0 && (
          <div className="mb-3 rounded-lg border border-border/60">
            <div className="px-3 py-2 text-xs text-muted-foreground border-b border-border/60">
              Recent
            </div>
            {recent.slice(0, 5).map((t, i) => (
              <button
                key={`recent-${i}`}
                onClick={() => {
                  saveRecent(t);
                  onSelect(t);
                  onClose();
                }}
                className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-secondary/50"
              >
                <div className="flex items-center gap-2">
                  <TokenLogo src={getTokenLogo(t)} alt={t.symbol} size={24} />
                  <div>
                    <div className="font-medium">{t.symbol}</div>
                    <div className="text-xs text-muted-foreground">
                      {t.address.slice(0, 12)}...
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium">{t.balanceFormatted}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="max-h-72 overflow-y-auto rounded-lg border border-border/60">
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              No tokens found
            </div>
          ) : (
            filtered.map((t, i) => (
              <button
                key={`tok-${i}`}
                onClick={() => {
                  saveRecent(t);
                  onSelect(t);
                  onClose();
                }}
                className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-secondary/50"
              >
                <div className="flex items-center gap-2">
                  <TokenLogo src={getTokenLogo(t)} alt={t.symbol} size={24} />
                  <div>
                    <div className="font-medium">{t.symbol}</div>
                    <div className="text-xs text-muted-foreground">
                      {t.address.slice(0, 12)}...{t.address.slice(-8)}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium">{t.balanceFormatted}</div>
                </div>
              </button>
            ))
          )}
        </div>

        <div className="mt-3 text-xs text-muted-foreground">
          {tokens.length} tokens available in your wallet
        </div>
      </div>
    </div>
  );
}
