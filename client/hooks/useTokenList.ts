import { useQuery } from "@tanstack/react-query";

export type RemoteToken = {
  symbol: string;
  name: string;
  address: `0x${string}`;
  decimals: number;
  logoURI?: string;
};

async function fetchOpenOceanBaseTokens(): Promise<RemoteToken[]> {
  try {
    const url = "https://open-api.openocean.finance/v4/base/tokenList";
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`OpenOcean tokenList failed: ${res.status}`);
    const json = await res.json();
    const list: any[] = json?.data?.tokens || json?.data || [];
    return list
      .map((t) => ({
        symbol: String(t.symbol || "").toUpperCase(),
        name: String(t.name || t.symbol || "Token"),
        address: (t.address || t.contract || t.addr) as `0x${string}`,
        decimals: Number(t.decimals ?? t.decimal ?? 18),
        logoURI: t.logoURI || t.logo || t.icon || undefined,
      }))
      .filter((t) => /^0x[a-fA-F0-9]{40}$/.test(t.address));
  } catch (err) {
    console.warn("OpenOcean token list fetch failed", err);
    return [];
  }
}

export function useTokenList() {
  return useQuery({
    queryKey: ["oo-token-list", "base"],
    queryFn: fetchOpenOceanBaseTokens,
    staleTime: 1000 * 60 * 30,
  });
}
