// Keeta token constants

export const KEETA_TOKENS = {
  KTA: 'keeta_anyiff4v34alvumupagmdyosydeq24lc4def5mrpmmyhx3j6vj2uucckeqn52',
  RIDE: 'keeta_anchh4m5ukgvnx5jcwe56k3ltgo4x4kppicdjgcaftx4525gdvknf73fotmdo',
  // Add more tokens as needed
} as const;

export function isKTAToken(address: string): boolean {
  return address === KEETA_TOKENS.KTA;
}
