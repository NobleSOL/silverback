// src/utils/constants.js
import 'dotenv/config';

// Use lazy initialization to avoid temporal dead zone errors in complex module graphs
let _config = null;

function getConfig() {
  if (!_config) {
    _config = {
      // Network
      NETWORK: process.env.NETWORK || 'test',
      NODE_HTTP: process.env.NODE_HTTP || 'https://api.test.keeta.com',

      // Fees (basis points: 30 = 0.3%)
      SWAP_FEE_BPS: Number(process.env.SWAP_FEE_BPS || 30),           // Total: 0.3%
      LP_FEE_BPS: Number(process.env.LP_FEE_BPS || 25),               // LP: 0.25% (stays in pool)
      PROTOCOL_FEE_BPS: Number(process.env.PROTOCOL_FEE_BPS || 5),    // Protocol: 0.05% (to treasury)

      // Known tokens (mainnet KTA)
      BASE_TOKEN: process.env.BASE_TOKEN || 'keeta_anqdilpazdekdu4acw65fj7smltcp26wbrildkqtszqvverljpwpezmd44ssg',

      // Server
      PORT: Number(process.env.PORT || 8888),
      CORS_ORIGINS: process.env.CORS_ALLOWED_ORIGINS?.split(',') || [
        'https://dexkeeta.vercel.app',
        'http://localhost:8080',
        'http://localhost:5173',
      ],
    };
  }
  return _config;
}

// Export as CONFIG property getter for backward compatibility
export const CONFIG = new Proxy({}, {
  get(target, prop) {
    return getConfig()[prop];
  }
});

// Helper to convert basis points to fraction
export function bpsToFraction(bps) {
  return {
    numerator: BigInt(bps),
    denominator: 10000n,
  };
}

// Helper: Convert human amount to atomic
export function toAtomic(amount, decimals) {
  return BigInt(Math.round(amount * 10 ** decimals));
}

// Helper: Convert atomic amount to human
export function fromAtomic(amount, decimals) {
  return Number(amount) / 10 ** decimals;
}

// Helper: Format token pair key
export function getPairKey(tokenA, tokenB) {
  // Sort alphabetically to ensure consistent keys
  const [token0, token1] = [tokenA, tokenB].sort();
  return `${token0}_${token1}`;
}

// Helper: Parse pair key
export function parsePairKey(pairKey) {
  const [token0, token1] = pairKey.split('_');
  return { token0, token1 };
}

// Helper: Validate hex seed
export function validateHexSeed(seed) {
  return /^[0-9A-Fa-f]{64}$/.test(seed.trim());
}

// Helper: Load seed from env
export function seedFromHexEnv(varName) {
  const raw = process.env[varName];
  if (!raw) throw new Error(`${varName} missing in .env`);
  if (!validateHexSeed(raw)) {
    throw new Error(`${varName} must be 64 hex characters`);
  }
  return Buffer.from(raw.trim(), 'hex');
}

// Token decimals cache (in-memory for now)
const decimalsCache = new Map();

// Pre-populate known tokens (mainnet)
const KNOWN_TOKEN_DECIMALS = {
  // KTA token (mainnet)
  'keeta_anqdilpazdekdu4acw65fj7smltcp26wbrildkqtszqvverljpwpezmd44ssg': 9,
};

// Initialize cache with known tokens
Object.entries(KNOWN_TOKEN_DECIMALS).forEach(([address, decimals]) => {
  decimalsCache.set(address, decimals);
});

export function cacheDecimals(tokenAddress, decimals) {
  decimalsCache.set(tokenAddress, decimals);
}

export function getCachedDecimals(tokenAddress) {
  return decimalsCache.get(tokenAddress);
}
