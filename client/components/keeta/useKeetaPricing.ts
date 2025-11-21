import { useQuery } from "@tanstack/react-query";

// API base URL - uses environment variable if set, otherwise falls back to same origin
const API_BASE = import.meta.env.VITE_KEETA_API_BASE || `${window.location.origin}/api`;

export type KeetaTokenPrice = {
  address: string;
  priceUsd: number | null;
  change24h: number | null;
};

async function fetchKeetaTokenPrices(
  addresses: string[],
): Promise<Record<string, KeetaTokenPrice>> {
  const addrs = Array.from(new Set(addresses.filter(Boolean)));
  if (addrs.length === 0) return {};

  const url = `${API_BASE}/pricing/tokens?addresses=${addrs.join(",")}`;

  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`Keeta pricing failed: ${res.status}`);
    const json = await res.json();

    if (!json.success) {
      throw new Error(json.error || "Failed to fetch prices");
    }

    return json.prices || {};
  } catch (err) {
    console.warn("Keeta pricing fetch failed", err);
    return Object.fromEntries(
      addrs.map((a) => [
        a,
        { address: a, priceUsd: null, change24h: null },
      ]),
    );
  }
}

export function useKeetaTokenPrices(addresses: string[]) {
  const key = [
    "keeta-pricing",
    "tokens",
    ...addresses.map((a) => a?.toLowerCase()).sort(),
  ];

  return useQuery({
    queryKey: key,
    queryFn: () => fetchKeetaTokenPrices(addresses),
    // Update prices every minute
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
