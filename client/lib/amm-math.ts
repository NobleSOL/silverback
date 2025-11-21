/**
 * Client-side AMM math utilities
 * Implements constant product formula (x * y = k) for instant quote calculations
 *
 * This eliminates the need to call backend API for quotes, reducing latency and server load.
 * The backend is still needed for TX2 publishing (OPS SEND_ON_BEHALF permission).
 */

export interface SwapQuote {
  amountOut: bigint;
  amountOutHuman: string;
  feeAmount: bigint;
  priceImpact: number;
  minimumReceived: string;
}

/**
 * Calculate output amount for a swap using constant product formula (x * y = k)
 * Includes 0.3% fee calculation (30 basis points)
 *
 * Formula:
 * - Fee: feeAmount = amountIn * 0.003
 * - Amount after fee: amountInAfterFee = amountIn - feeAmount
 * - Output: amountOut = (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee)
 * - Price impact: |1 - (executionPrice / exactPrice)| * 100
 *
 * @param amountInHuman - Human-readable amount of input token (e.g., "1.5")
 * @param reserveIn - Reserve of input token in pool (atomic units)
 * @param reserveOut - Reserve of output token in pool (atomic units)
 * @param decimalsIn - Decimals of input token
 * @param decimalsOut - Decimals of output token
 * @param slippagePercent - Slippage tolerance (default 0.5%)
 * @param feeBps - Fee in basis points (default 30 = 0.3%)
 * @returns SwapQuote with amountOut, fee, price impact, and minimum received
 */
export function calculateSwapQuote(
  amountInHuman: string,
  reserveIn: string,
  reserveOut: string,
  decimalsIn: number,
  decimalsOut: number,
  slippagePercent: number = 0.5,
  feeBps: number = 30
): SwapQuote {
  try {
    // Convert inputs to BigInt
    const amountIn = toAtomic(parseFloat(amountInHuman), decimalsIn);
    const reserveInBig = BigInt(reserveIn);
    const reserveOutBig = BigInt(reserveOut);

    // Validate inputs
    if (amountIn <= 0n) {
      throw new Error('Amount must be positive');
    }
    if (reserveInBig <= 0n || reserveOutBig <= 0n) {
      throw new Error('Insufficient liquidity');
    }

    // Calculate fee (0.3% = 30 basis points)
    const feeAmount = (amountIn * BigInt(feeBps)) / 10000n;

    // Amount after fee
    const amountInAfterFee = amountIn - feeAmount;

    // Constant product formula: (x + Δx) * (y - Δy) = x * y
    // Solving for Δy: Δy = (y * Δx) / (x + Δx)
    const numerator = reserveOutBig * amountInAfterFee;
    const denominator = reserveInBig + amountInAfterFee;
    const amountOut = numerator / denominator;

    // Calculate price impact
    const exactPrice = Number(reserveOutBig) / Number(reserveInBig);
    const executionPrice = Number(amountOut) / Number(amountInAfterFee);
    const priceImpact = Math.abs(1 - executionPrice / exactPrice) * 100;

    // Convert amountOut to human-readable
    const amountOutHuman = fromAtomic(amountOut, decimalsOut);

    // Calculate minimum received with slippage
    const slippageFactor = 1 - slippagePercent / 100;
    const minimumReceived = (Number(amountOutHuman) * slippageFactor).toFixed(
      Math.min(decimalsOut, 6)
    );

    console.log('📊 Client-side swap quote calculated:', {
      amountIn: amountInHuman,
      amountOut: amountOutHuman,
      fee: fromAtomic(feeAmount, decimalsIn),
      priceImpact: priceImpact.toFixed(2) + '%',
      minimumReceived,
    });

    return {
      amountOut,
      amountOutHuman,
      feeAmount,
      priceImpact,
      minimumReceived,
    };
  } catch (error: any) {
    console.error('❌ Client-side quote calculation error:', error);
    throw error;
  }
}

/**
 * Convert human-readable amount to atomic units (with decimals)
 * Example: 1.5 KTA (9 decimals) => 1500000000n
 */
function toAtomic(amount: number, decimals: number): bigint {
  const multiplier = Math.pow(10, decimals);
  const atomic = Math.floor(amount * multiplier);
  return BigInt(atomic);
}

/**
 * Convert atomic units to human-readable amount
 * Example: 1500000000n KTA (9 decimals) => "1.5"
 */
function fromAtomic(amount: bigint, decimals: number): string {
  const divisor = Math.pow(10, decimals);
  const human = Number(amount) / divisor;

  // Remove trailing zeros for cleaner display
  return parseFloat(human.toFixed(Math.min(decimals, 6))).toString();
}

/**
 * Calculate price (exchange rate) between two tokens
 *
 * @param reserveA - Reserve of token A (atomic units)
 * @param reserveB - Reserve of token B (atomic units)
 * @param decimalsA - Decimals of token A
 * @param decimalsB - Decimals of token B
 * @returns Exchange rates in both directions
 */
export function calculatePrice(
  reserveA: string,
  reserveB: string,
  decimalsA: number,
  decimalsB: number
): { priceAtoB: number; priceBtoA: number } {
  const reserveABig = BigInt(reserveA);
  const reserveBBig = BigInt(reserveB);

  if (reserveABig === 0n || reserveBBig === 0n) {
    return { priceAtoB: 0, priceBtoA: 0 };
  }

  const adjustedA = Number(reserveABig) / Math.pow(10, decimalsA);
  const adjustedB = Number(reserveBBig) / Math.pow(10, decimalsB);

  return {
    priceAtoB: adjustedB / adjustedA, // How much B for 1 A
    priceBtoA: adjustedA / adjustedB, // How much A for 1 B
  };
}
