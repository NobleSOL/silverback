// Client-side swap calculations for Keythings wallet
// Mirrors server/keeta-impl/contracts/Pool.js swap logic

const CONFIG = {
  SWAP_FEE_BPS: 30, // 0.3% total fee
  PROTOCOL_FEE_BPS: 5, // 0.05% protocol fee
};

/**
 * Calculate swap output amount with fees
 * Formula: (amountIn * 0.997 * reserveOut) / (reserveIn + amountIn * 0.997)
 */
export function calculateSwapOutput(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: number = CONFIG.SWAP_FEE_BPS
): {
  amountOut: bigint;
  feeAmount: bigint;
  priceImpact: number;
} {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) {
    throw new Error('Invalid amounts for swap calculation');
  }

  // Calculate fee (0.3% = 30 basis points)
  const feeAmount = (amountIn * BigInt(feeBps)) / 10000n;
  const amountInAfterFee = amountIn - feeAmount;

  // Constant product formula: x * y = k
  // amountOut = (amountInAfterFee * reserveOut) / (reserveIn + amountInAfterFee)
  const numerator = amountInAfterFee * reserveOut;
  const denominator = reserveIn + amountInAfterFee;
  const amountOut = numerator / denominator;

  // Calculate price impact
  // Price impact = (amountIn / reserveIn) * 100
  const priceImpact = Number((amountIn * 10000n) / reserveIn) / 100;

  return {
    amountOut,
    feeAmount,
    priceImpact,
  };
}

/**
 * Calculate fee split (SushiSwap model)
 * Total fee: 0.3%
 * - 0.25% to LPs (stays in pool)
 * - 0.05% to protocol (treasury)
 */
export function calculateFeeSplit(amountIn: bigint): {
  protocolFee: bigint;
  amountToPool: bigint;
} {
  const protocolFee = (amountIn * BigInt(CONFIG.PROTOCOL_FEE_BPS)) / 10000n; // 0.05%
  const amountToPool = amountIn - protocolFee; // 99.95%

  return {
    protocolFee,
    amountToPool,
  };
}

/**
 * Convert human-readable amount to atomic units
 */
export function toAtomic(amount: number | string, decimals: number): bigint {
  const amountNum = typeof amount === 'string' ? parseFloat(amount) : amount;
  return BigInt(Math.floor(amountNum * Math.pow(10, decimals)));
}

/**
 * Convert atomic units to human-readable amount
 */
export function fromAtomic(amount: bigint, decimals: number): string {
  const amountNum = Number(amount) / Math.pow(10, decimals);
  return parseFloat(amountNum.toFixed(Math.min(decimals, 6))).toString();
}
