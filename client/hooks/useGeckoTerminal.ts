import { useQuery } from "@tanstack/react-query";

// BACK/VIRTUAL pool on Base
const BACK_POOL_ADDRESS = "0x9b8c88fd9372a3c8f3526e71ffd5de0972006bba";

export type GeckoTerminalTokenStats = {
  priceUsd: number | null;
  change24h: number | null;
};

async function fetchBackPrice(): Promise<GeckoTerminalTokenStats> {
  try {
    const url = `https://api.geckoterminal.com/api/v2/networks/base/pools/${BACK_POOL_ADDRESS}`;
    const res = await fetch(url, { headers: { accept: "application/json" } });

    if (!res.ok) {
      throw new Error(`GeckoTerminal API failed: ${res.status}`);
    }

    const json = await res.json();
    const attrs = json?.data?.attributes;

    if (!attrs) {
      return { priceUsd: null, change24h: null };
    }

    const priceUsd = attrs.base_token_price_usd
      ? parseFloat(attrs.base_token_price_usd)
      : null;

    const change24h = attrs.price_change_percentage?.h24
      ? parseFloat(attrs.price_change_percentage.h24)
      : null;

    return { priceUsd, change24h };
  } catch (err) {
    console.warn("GeckoTerminal fetch failed:", err);
    return { priceUsd: null, change24h: null };
  }
}

export function useBackPrice() {
  return useQuery({
    queryKey: ["geckoterminal", "back-price"],
    queryFn: fetchBackPrice,
    staleTime: 60_000, // Cache for 1 minute
    refetchInterval: 60_000, // Refresh every minute
  });
}
