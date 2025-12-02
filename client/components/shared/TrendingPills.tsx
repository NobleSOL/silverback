import React, { useMemo } from "react";
import TokenLogo from "@/components/shared/TokenLogo";
import { tokenBySymbol, TOKEN_META } from "@/lib/tokens";
import { useTokenList } from "@/hooks/useTokenList";
import { useDexscreenerTokenStats } from "@/hooks/useDexscreener";
import { useBackPrice } from "@/hooks/useGeckoTerminal";

function resolveBaseAddressForSymbol(
  symbol: string,
  remoteSymbols: Record<string, { address: `0x${string}` }>,
): `0x${string}` | null {
  const s = symbol.toUpperCase();
  // Special-case native ETH on Base -> WETH contract address
  if (s === "ETH") return "0x4200000000000000000000000000000000000006";
  // Prefer remote token list
  const remote = remoteSymbols[s];
  if (remote?.address) return remote.address;
  // Fallback to any address provided in static meta
  const meta = TOKEN_META[s];
  if (meta?.address) return meta.address as `0x${string}`;
  return null;
}

export default function TrendingPills({ symbols, title = "Trending on Base" }: { symbols: string[]; title?: string }) {
  const { data: remoteTokens } = useTokenList();
  const { data: backPrice, isLoading: backLoading } = useBackPrice();

  const remoteBySymbol = useMemo(() => {
    const map: Record<string, { address: `0x${string}` }> = {};
    for (const t of remoteTokens || []) {
      const sym = String(t.symbol || "").toUpperCase();
      if (!map[sym]) map[sym] = { address: t.address };
    }
    return map;
  }, [remoteTokens]);

  const items = useMemo(
    () =>
      symbols.map((s) => ({ ...tokenBySymbol(s), symbol: s.toUpperCase() })),
    [symbols],
  );
  // Filter out BACK from Dexscreener query (use GeckoTerminal instead)
  const addresses = useMemo(
    () =>
      items
        .filter((it) => it.symbol !== "BACK")
        .map((it) => resolveBaseAddressForSymbol(it.symbol, remoteBySymbol))
        .filter(Boolean) as string[],
    [items, remoteBySymbol],
  );
  const { data: stats, isLoading } = useDexscreenerTokenStats(addresses);

  return (
    <div>
      <div className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <ul className="space-y-3">
        {items.map((t) => {
          // Use GeckoTerminal for BACK, Dexscreener for others
          const isBack = t.symbol === "BACK";
          const addr =
            resolveBaseAddressForSymbol(
              t.symbol,
              remoteBySymbol,
            )?.toLowerCase() || "";
          const s = isBack ? null : (stats || {})[addr];

          // Get price and change based on source
          const priceUsd = isBack ? backPrice?.priceUsd : s?.priceUsd;
          const change24h = isBack ? backPrice?.change24h : s?.change24h;
          const loading = isBack ? backLoading : isLoading;

          const price =
            priceUsd != null
              ? `$${priceUsd < 0.0001 ? priceUsd.toFixed(8) : priceUsd < 1 ? priceUsd.toFixed(4) : priceUsd.toFixed(2)}`
              : "—";
          const ch = change24h;
          const chStr =
            ch != null ? `${ch >= 0 ? "+" : ""}${ch.toFixed(2)}%` : "—";
          const chColor =
            ch == null
              ? "text-muted-foreground"
              : ch >= 0
                ? "text-emerald-400"
                : "text-red-400";
          return (
            <li
              key={t.symbol}
              className="flex items-center justify-between rounded-lg bg-secondary/40 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <TokenLogo src={t.logo} alt={`${t.name} logo`} size={20} />
                <span className="font-medium">{t.symbol}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  {loading && priceUsd == null ? "" : price}
                </span>
                <span className={`text-xs ${chColor}`}>
                  {loading && ch == null ? "" : chStr}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
