export const AGG_SOURCES = [
  "aerodrome",
  "sushi",
  "uniswapv2",
  "uniswapv3",
] as const;
export type AggSource = (typeof AGG_SOURCES)[number];

export const FEE_BPS = 30; // 0.3%
export const FEE_RECIPIENT =
  "0xD34411a70EffbDd000c529bbF572082ffDcF1794" as const;
export const FEE_ASSET = "ETH" as const; // fee paid in ETH
export const FEE_MODE = "deduct_before_swap" as const; // deduct fee first, then execute swap

export const DEFAULT_SLIPPAGE_BPS = 50; // 0.50%
export const DEFAULT_DEADLINE_SEC = 20 * 60;

export const BASE_RPC_URL =
  (import.meta as any).env?.VITE_BASE_RPC_URL || "https://mainnet.base.org";

export type Address = `0x${string}`;

export type TokenInfo = {
  symbol: string;
  address: Address;
  decimals: number;
  logo?: string;
};
