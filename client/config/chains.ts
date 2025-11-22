// Chain configuration for Base to Keeta bridge
import { base } from 'viem/chains';

export const CHAIN_CONFIG = {
  base: {
    id: base.id,
    name: 'Base',
    nativeCurrency: base.nativeCurrency,
    rpcUrls: base.rpcUrls,
    blockExplorers: base.blockExplorers,
  },
  keeta: {
    id: 'keeta-testnet',
    name: 'Keeta Testnet',
    rpcUrl: 'https://api.test.keeta.com/rpc',
    explorer: 'https://explorer.test.keeta.com',
  },
} as const;

// Anchor contract configuration
export const ANCHOR_CONFIG = {
  // TODO: Replace with actual Base Anchor contract address
  baseAnchorAddress: '0x0000000000000000000000000000000000000000' as `0x${string}`,

  supportedTokens: {
    USDC: {
      symbol: 'USDC',
      name: 'USD Coin',
      baseAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`,
      keetaAddress: 'keeta_...' as string, // TODO: Update with actual Keeta USDC address
      decimals: 6,
      logo: 'https://assets.kraken.com/marketing/web/icons-uni-webp/s_usdc.webp?i=kds',
    },
    KTA: {
      symbol: 'KTA',
      name: 'Keeta',
      baseAddress: '0xc0634090F2Fe6c6d75e61Be2b949464aBB498973' as `0x${string}`,
      keetaAddress: 'keeta_anyiff4v34alvumupagmdyosydeq24lc4def5mrpmmyhx3j6vj2uucckeqn52' as string,
      decimals: 18,
      logo: 'https://assets.kraken.com/marketing/web/icons-uni-webp/s_kta.webp?i=kds',
    },
  },

  fees: {
    anchorBaseFee: 0.001, // 0.1% base anchor fee
    silverbackFee: 0.005, // 0.5% Silverback protocol fee
    totalFee: 0.006, // 0.6% total
  },

  estimatedBridgeTime: 180, // 3 minutes in seconds
} as const;

export type SupportedToken = keyof typeof ANCHOR_CONFIG.supportedTokens;
