import { useQuery } from "@tanstack/react-query";

export type DexscreenerTokenStats = {
  address: `0x${string}`;
  priceUsd: number | null;
  change24h: number | null;
};

async function fetchDexscreenerTokens(
  addresses: string[],
): Promise<Record<string, DexscreenerTokenStats>> {
  const addrs = Array.from(new Set(addresses.filter(Boolean))).map((a) =>
    a.toLowerCase(),
  );
  if (addrs.length === 0) return {};
  const url = `https://api.dexscreener.com/latest/dex/tokens/${addrs.join(",")}`;

  let json: any;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`Dexscreener tokens failed: ${res.status}`);
    json = await res.json();
  } catch (err) {
    console.warn("Dexscreener fetch failed", err);
    return Object.fromEntries(
      addrs.map((a) => [
        a,
        { address: a as `0x${string}`, priceUsd: null, change24h: null },
      ]),
    );
  }

  const pairs: any[] = json?.pairs || [];
  const bestByAddr: Record<string, any> = {};
  for (const p of pairs) {
    const tokenAddrs = [p.baseToken?.address, p.quoteToken?.address]
      .filter(Boolean)
      .map((a: string) => a.toLowerCase());
    const liq = Number(p.liquidity?.usd ?? 0);
    for (const a of tokenAddrs) {
      const prev = bestByAddr[a];
      if (!prev || Number(prev.liquidity?.usd ?? 0) < liq) bestByAddr[a] = p;
    }
  }
  const out: Record<string, DexscreenerTokenStats> = {};
  for (const a of addrs) {
    const p = bestByAddr[a];
    if (!p) {
      out[a] = { address: a as `0x${string}`, priceUsd: null, change24h: null };
      continue;
    }
    const priceUsd =
      p.priceUsd != null
        ? Number(p.priceUsd)
        : p.priceNative != null
          ? Number(p.priceNative)
          : null;
    const change24h =
      p.priceChange?.h24 != null ? Number(p.priceChange.h24) : null;
    out[a] = { address: a as `0x${string}`, priceUsd, change24h };
  }
  return out;
}

export function useDexscreenerTokenStats(addresses: string[]) {
  const key = [
    "dexscreener",
    "tokens",
    ...addresses.map((a) => a?.toLowerCase()).sort(),
  ];
  return useQuery({
    queryKey: key,
    queryFn: () => fetchDexscreenerTokens(addresses),
    // Dexscreener doesn't change that frequently; cache for a minute
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
