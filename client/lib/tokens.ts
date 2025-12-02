export type TokenMeta = {
  symbol: string;
  name: string;
  logo?: string;
  address?: `0x${string}`;
  decimals?: number;
};

// Public, cacheable logos. Fallback handled in TokenLogo component.
export const TOKEN_META: Record<string, TokenMeta> = {
  ETH: {
    symbol: "ETH",
    name: "Ether",
    logo: "https://assets.coingecko.com/coins/images/279/standard/ethereum.png",
    address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", // Native ETH sentinel
    decimals: 18,
  },
  WETH: {
    symbol: "WETH",
    name: "Wrapped Ether",
    logo: "https://assets.coingecko.com/coins/images/279/standard/ethereum.png",
    address: "0x4200000000000000000000000000000000000006", // WETH on Base
    decimals: 18,
  },
  USDC: {
    symbol: "USDC",
    name: "USD Coin",
    logo: "https://assets.kraken.com/marketing/web/icons-uni-webp/s_usdc.webp?i=kds",
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
  },
  WBTC: {
    symbol: "WBTC",
    name: "Wrapped BTC",
    logo: "https://assets.coingecko.com/coins/images/7598/standard/wrapped_bitcoin_wbtc.png",
  },
  AERO: {
    symbol: "AERO",
    name: "Aerodrome",
    logo: "https://assets.kraken.com/marketing/web/icons-uni-webp/s_aero.webp?i=kds",
    address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
    decimals: 18,
  },
  DEGEN: {
    symbol: "DEGEN",
    name: "Degen",
    logo: "https://assets.coingecko.com/coins/images/36110/standard/degen.png",
  },
  BACK: {
    symbol: "BACK",
    name: "Silverback",
    logo: "https://cdn.builder.io/api/v1/image/assets%2Fd70091a6f5494e0195b033a72f7e79ae%2Fee3a0a5652aa480f9aa42277503e94b2?format=webp&width=64",
    address: "0x558881c4959e9cf961a7e1815fcd6586906babd2",
    decimals: 18,
  },
  KTA: {
    symbol: "KTA",
    name: "Keeta",
    logo: "https://assets.kraken.com/marketing/web/icons-uni-webp/s_kta.webp?i=kds",
    address: "0xc0634090F2Fe6c6d75e61Be2b949464aBB498973",
    decimals: 18,
  },
};

export function tokenBySymbol(symbol: string): TokenMeta {
  const key = symbol.toUpperCase();
  return TOKEN_META[key] ?? { symbol: key, name: key };
}
