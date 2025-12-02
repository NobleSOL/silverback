import { useEffect, useMemo, useState } from "react";
import TokenLogo from "@/components/shared/TokenLogo";
import { Button } from "@/components/ui/button";
import { TOKEN_META } from "@/lib/tokens";
import type { Token } from "./TokenInput";
import { usePublicClient } from "wagmi";
import type { Address } from "viem";
import { ERC20_ABI } from "@/lib/erc20";
import { useTokenList } from "@/hooks/useTokenList";

function isAddress(v: string): v is Address {
  return /^0x[a-fA-F0-9]{40}$/.test(v);
}

export default function TokenSelector({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (t: Token) => void;
}) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [customToken, setCustomToken] = useState<Token | null>(null);
  const publicClient = usePublicClient();

  const { data: remoteTokens } = useTokenList();
  const knownTokens: Token[] = useMemo(() => {
    const local: Token[] = Object.values(TOKEN_META).map((m) => ({ ...m }));
    const remote: Token[] = (remoteTokens || []).map((t) => ({
      symbol: t.symbol?.toUpperCase(),
      name: t.name,
      address: t.address,
      decimals: t.decimals,
      logo: t.logoURI,
    }));

    // Prefer remote entries (with address) over local by symbol
    const bySymbol = new Map<string, Token>();
    remote.forEach((t) => {
      if (!t?.symbol) return;
      bySymbol.set(t.symbol.toUpperCase(), t);
    });
    local.forEach((t) => {
      const key = t.symbol.toUpperCase();
      if (!bySymbol.has(key)) bySymbol.set(key, t);
    });

    // Also ensure no duplicate addresses
    const seenAddr = new Set<string>();
    const merged: Token[] = [];
    for (const t of bySymbol.values()) {
      const addr = (t.address || "").toLowerCase();
      if (addr) {
        if (seenAddr.has(addr)) continue;
        seenAddr.add(addr);
      }
      merged.push(t);
    }

    return merged.sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [remoteTokens]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base =
      !q || isAddress(q)
        ? knownTokens
        : knownTokens.filter(
            (t) =>
              t.symbol.toLowerCase().includes(q) ||
              t.name.toLowerCase().includes(q),
          );
    // De-duplicate by address+symbol composite
    const seen = new Set<string>();
    const out: Token[] = [];
    for (const t of base) {
      const id = `${t.symbol.toUpperCase()}-${(t.address || "").toLowerCase()}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(t);
    }
    return out;
  }, [knownTokens, query]);

  useEffect(() => {
    let cancel = false;
    async function fetchCustom() {
      if (!open) return;
      const q = query.trim();
      if (!isAddress(q) || !publicClient) {
        setCustomToken(null);
        return;
      }
      setLoading(true);
      try {
        const [symbol, name, decimals] = await Promise.all([
          publicClient.readContract({
            address: q,
            abi: ERC20_ABI,
            functionName: "symbol",
          }) as Promise<string>,
          publicClient.readContract({
            address: q,
            abi: ERC20_ABI,
            functionName: "name",
          }) as Promise<string>,
          publicClient.readContract({
            address: q,
            abi: ERC20_ABI,
            functionName: "decimals",
          }) as Promise<number>,
        ]);
        if (!cancel) {
          // Check if token exists in TOKEN_META (by symbol or address)
          const upperSymbol = (symbol || "TOKEN").toUpperCase();
          const meta = TOKEN_META[upperSymbol];

          // Use logo from TOKEN_META if available (match by symbol or address)
          let logo: string | undefined;
          if (meta?.logo) {
            // Check if address matches or if it's just by symbol
            if (meta.address?.toLowerCase() === q.toLowerCase() || !meta.address) {
              logo = meta.logo;
            }
          }

          // Also check all TOKEN_META entries for address match
          if (!logo) {
            for (const [, tokenMeta] of Object.entries(TOKEN_META)) {
              if (tokenMeta.address?.toLowerCase() === q.toLowerCase() && tokenMeta.logo) {
                logo = tokenMeta.logo;
                break;
              }
            }
          }

          setCustomToken({
            symbol: symbol || "TOKEN",
            name: name || symbol || "Token",
            decimals,
            address: q,
            logo,
          });
        }
      } catch (e) {
        if (!cancel) setCustomToken(null);
      } finally {
        if (!cancel) setLoading(false);
      }
    }
    fetchCustom();
    return () => {
      cancel = true;
    };
  }, [open, publicClient, query]);

  const [recent, setRecent] = useState<Token[]>(() => {
    try {
      const raw = localStorage.getItem("recentTokens");
      return raw ? (JSON.parse(raw) as Token[]) : [];
    } catch {
      return [];
    }
  });
  const saveRecent = (t: Token) => {
    const map = new Map<string, Token>();
    [t, ...recent].forEach((x) =>
      map.set(
        `${x.symbol.toUpperCase()}-${(x.address || "").toLowerCase()}`,
        x,
      ),
    );
    const arr = Array.from(map.values()).slice(0, 8);
    setRecent(arr);
    try {
      localStorage.setItem("recentTokens", JSON.stringify(arr));
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
          placeholder="Search name or paste address (0x...)"
          className="mb-3 w-full rounded-lg border border-border/60 bg-secondary/60 px-3 py-2 outline-none placeholder:text-muted-foreground/60"
        />

        {!query && recent.length > 0 && (
          <div className="mb-3 rounded-lg border border-border/60">
            {recent.map((t, i) => (
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
                  <TokenLogo src={t.logo} alt={`${t.name} logo`} size={20} />
                  <div>
                    <div className="font-medium">{t.symbol}</div>
                    <div className="text-xs text-muted-foreground">
                      {t.name}
                    </div>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">Recent</span>
              </button>
            ))}
          </div>
        )}

        {isAddress(query.trim()) ? (
          <div className="mb-3">
            <div className="mb-2 text-xs text-muted-foreground">
              {loading
                ? "Fetching token..."
                : customToken
                  ? "Custom token"
                  : "No token found"}
            </div>
            {customToken && (
              <button
                onClick={() => {
                  saveRecent(customToken);
                  onSelect(customToken);
                  onClose();
                }}
                className="flex w-full items-center justify-between rounded-lg border border-border/60 bg-secondary/40 px-3 py-2 text-left hover:bg-secondary/60"
              >
                <div className="flex items-center gap-2">
                  <TokenLogo
                    src={customToken.logo}
                    alt={`${customToken.name} logo`}
                    size={20}
                  />
                  <div>
                    <div className="font-medium">{customToken.symbol}</div>
                    <div className="text-xs text-muted-foreground">
                      {customToken.name}
                    </div>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">Add</span>
              </button>
            )}
          </div>
        ) : null}

        <div className="max-h-72 overflow-y-auto rounded-lg border border-border/60">
          {filtered.map((t, i) => (
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
                <TokenLogo src={t.logo} alt={`${t.name} logo`} size={20} />
                <div>
                  <div className="font-medium">{t.symbol}</div>
                  <div className="text-xs text-muted-foreground">{t.name}</div>
                </div>
              </div>
              <span className="text-xs text-muted-foreground">Select</span>
            </button>
          ))}
        </div>

        <div className="mt-3 text-xs text-muted-foreground">
          Tip: Paste a token contract address to import a token.
        </div>
      </div>
    </div>
  );
}
