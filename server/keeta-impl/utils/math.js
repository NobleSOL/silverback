// src/utils/math.js

/**
 * Calculate output amount for a swap using constant product formula (x * y = k)
 * Includes fee calculation
 * 
 * @param {bigint} amountIn - Amount of input token
 * @param {bigint} reserveIn - Reserve of input token in pool
 * @param {bigint} reserveOut - Reserve of output token in pool
 * @param {number} feeBps - Fee in basis points (e.g., 30 for 0.3%)
 * @returns {{ amountOut: bigint, feeAmount: bigint, priceImpact: number }}
 */
export function calculateSwapOutput(amountIn, reserveIn, reserveOut, feeBps = 30) {
  // Validate inputs before conversion
  if (amountIn === undefined || amountIn === null) {
    throw new Error('amountIn is required');
  }
  if (reserveIn === undefined || reserveIn === null) {
    throw new Error(`reserveIn is required (got: ${reserveIn})`);
  }
  if (reserveOut === undefined || reserveOut === null) {
    throw new Error(`reserveOut is required (got: ${reserveOut})`);
  }

  // Ensure all inputs are BigInt
  try {
    amountIn = typeof amountIn === 'bigint' ? amountIn : BigInt(amountIn);
    reserveIn = typeof reserveIn === 'bigint' ? reserveIn : BigInt(reserveIn);
    reserveOut = typeof reserveOut === 'bigint' ? reserveOut : BigInt(reserveOut);
  } catch (error) {
    throw new Error(`Failed to convert to BigInt: ${error.message}. amountIn=${amountIn}, reserveIn=${reserveIn}, reserveOut=${reserveOut}`);
  }

  if (amountIn <= 0n) throw new Error('Amount in must be positive');
  if (reserveIn <= 0n || reserveOut <= 0n) throw new Error('Insufficient liquidity');

  // Calculate fee - ensure feeBps is BigInt
  const feeNumerator = typeof feeBps === 'bigint' ? feeBps : BigInt(feeBps);
  const feeDenominator = 10000n;
  const feeAmount = (amountIn * feeNumerator) / feeDenominator;
  
  // Amount after fee
  const amountInAfterFee = amountIn - feeAmount;
  
  // Constant product formula: (x + Δx) * (y - Δy) = x * y
  // Δy = (y * Δx) / (x + Δx)
  const numerator = reserveOut * amountInAfterFee;
  const denominator = reserveIn + amountInAfterFee;
  const amountOut = numerator / denominator;
  
  // Calculate price impact
  const exactPrice = (Number(reserveOut) / Number(reserveIn));
  const executionPrice = Number(amountOut) / Number(amountInAfterFee);
  const priceImpact = Math.abs(1 - (executionPrice / exactPrice)) * 100;
  
  return {
    amountOut,
    feeAmount,
    priceImpact,
  };
}

/**
 * Calculate input amount needed for a desired output amount
 * 
 * @param {bigint} amountOut - Desired amount of output token
 * @param {bigint} reserveIn - Reserve of input token in pool
 * @param {bigint} reserveOut - Reserve of output token in pool
 * @param {number} feeBps - Fee in basis points
 * @returns {{ amountIn: bigint, feeAmount: bigint }}
 */
export function calculateSwapInput(amountOut, reserveIn, reserveOut, feeBps = 30) {
  // Ensure all inputs are BigInt
  amountOut = typeof amountOut === 'bigint' ? amountOut : BigInt(amountOut);
  reserveIn = typeof reserveIn === 'bigint' ? reserveIn : BigInt(reserveIn);
  reserveOut = typeof reserveOut === 'bigint' ? reserveOut : BigInt(reserveOut);

  if (amountOut <= 0n) throw new Error('Amount out must be positive');
  if (amountOut >= reserveOut) throw new Error('Insufficient liquidity');
  if (reserveIn <= 0n || reserveOut <= 0n) throw new Error('Insufficient liquidity');
  
  // (x + Δx) * (y - Δy) = x * y
  // Δx = (x * Δy) / (y - Δy)
  const numerator = reserveIn * amountOut;
  const denominator = reserveOut - amountOut;
  const amountInBeforeFee = numerator / denominator;
  
  // Add fee back
  const feeNumerator = BigInt(feeBps);
  const feeDenominator = 10000n - feeNumerator;
  const amountIn = (amountInBeforeFee * 10000n) / feeDenominator;
  const feeAmount = amountIn - amountInBeforeFee;
  
  return {
    amountIn,
    feeAmount,
  };
}

/**
 * Calculate optimal amounts to add liquidity proportionally
 * 
 * @param {bigint} amountADesired - Desired amount of token A
 * @param {bigint} amountBDesired - Desired amount of token B
 * @param {bigint} reserveA - Current reserve of token A
 * @param {bigint} reserveB - Current reserve of token B
 * @returns {{ amountA: bigint, amountB: bigint }}
 */
export function calculateOptimalLiquidityAmounts(
  amountADesired,
  amountBDesired,
  reserveA,
  reserveB
) {
  if (reserveA === 0n && reserveB === 0n) {
    // First liquidity provision - use desired amounts
    return {
      amountA: amountADesired,
      amountB: amountBDesired,
    };
  }
  
  // Calculate optimal amount B based on amount A
  const amountBOptimal = (amountADesired * reserveB) / reserveA;
  
  if (amountBOptimal <= amountBDesired) {
    return {
      amountA: amountADesired,
      amountB: amountBOptimal,
    };
  }
  
  // Calculate optimal amount A based on amount B
  const amountAOptimal = (amountBDesired * reserveA) / reserveB;
  
  if (amountAOptimal <= amountADesired) {
    return {
      amountA: amountAOptimal,
      amountB: amountBDesired,
    };
  }
  
  throw new Error('Optimal amounts calculation failed');
}

/**
 * Calculate LP tokens to mint for liquidity provision
 * Uses geometric mean for first provision, proportional for subsequent
 * 
 * @param {bigint} amountA - Amount of token A being added
 * @param {bigint} amountB - Amount of token B being added
 * @param {bigint} reserveA - Current reserve of token A
 * @param {bigint} reserveB - Current reserve of token B
 * @param {bigint} totalSupply - Current total supply of LP tokens
 * @returns {bigint} - LP tokens to mint
 */
export function calculateLPTokensToMint(amountA, amountB, reserveA, reserveB, totalSupply) {
  if (totalSupply === 0n) {
    // First liquidity provision - use geometric mean
    // sqrt(amountA * amountB) - MINIMUM_LIQUIDITY
    const product = amountA * amountB;
    const liquidity = sqrt(product);
    
    // Lock minimum liquidity (1000 wei)
    const MINIMUM_LIQUIDITY = 1000n;
    if (liquidity <= MINIMUM_LIQUIDITY) {
      throw new Error('Insufficient initial liquidity');
    }
    
    return liquidity - MINIMUM_LIQUIDITY;
  }
  
  // Subsequent provisions - use proportional amount
  // min(amountA * totalSupply / reserveA, amountB * totalSupply / reserveB)
  const liquidityA = (amountA * totalSupply) / reserveA;
  const liquidityB = (amountB * totalSupply) / reserveB;
  
  return liquidityA < liquidityB ? liquidityA : liquidityB;
}

/**
 * Calculate amounts to receive when burning LP tokens
 * 
 * @param {bigint} liquidity - Amount of LP tokens to burn
 * @param {bigint} totalSupply - Total supply of LP tokens
 * @param {bigint} reserveA - Reserve of token A
 * @param {bigint} reserveB - Reserve of token B
 * @returns {{ amountA: bigint, amountB: bigint }}
 */
export function calculateAmountsForLPBurn(liquidity, totalSupply, reserveA, reserveB) {
  if (liquidity <= 0n || totalSupply <= 0n) {
    throw new Error('Invalid liquidity or total supply');
  }
  
  const amountA = (liquidity * reserveA) / totalSupply;
  const amountB = (liquidity * reserveB) / totalSupply;
  
  return { amountA, amountB };
}

/**
 * Calculate price (exchange rate) between two tokens
 * 
 * @param {bigint} reserveA - Reserve of token A
 * @param {bigint} reserveB - Reserve of token B
 * @param {number} decimalsA - Decimals of token A
 * @param {number} decimalsB - Decimals of token B
 * @returns {{ priceAtoB: number, priceBtoA: number }}
 */
export function calculatePrice(reserveA, reserveB, decimalsA, decimalsB) {
  if (reserveA === 0n || reserveB === 0n) {
    return { priceAtoB: 0, priceBtoA: 0 };
  }
  
  const adjustedA = Number(reserveA) / (10 ** decimalsA);
  const adjustedB = Number(reserveB) / (10 ** decimalsB);
  
  return {
    priceAtoB: adjustedB / adjustedA, // How much B for 1 A
    priceBtoA: adjustedA / adjustedB, // How much A for 1 B
  };
}

/**
 * Integer square root using Newton's method
 * 
 * @param {bigint} value
 * @returns {bigint}
 */
function sqrt(value) {
  if (value < 0n) throw new Error('Square root of negative number');
  if (value < 2n) return value;
  
  let z = value;
  let x = value / 2n + 1n;
  
  while (x < z) {
    z = x;
    x = (value / x + x) / 2n;
  }
  
  return z;
}

/**
 * Check if slippage is acceptable
 * 
 * @param {bigint} expectedAmount - Expected amount
 * @param {bigint} actualAmount - Actual amount received
 * @param {number} slippagePercent - Max acceptable slippage (e.g., 0.5 for 0.5%)
 * @returns {boolean}
 */
export function isSlippageAcceptable(expectedAmount, actualAmount, slippagePercent) {
  const slippageFactor = 1 - slippagePercent / 100;
  const minAmount = BigInt(Math.floor(Number(expectedAmount) * slippageFactor));
  return actualAmount >= minAmount;
}

/**
 * Calculate minimum amount out based on slippage tolerance
 * 
 * @param {bigint} amountOut - Expected amount out
 * @param {number} slippagePercent - Slippage tolerance (e.g., 0.5 for 0.5%)
 * @returns {bigint}
 */
export function calculateMinAmountOut(amountOut, slippagePercent) {
  const slippageFactor = 1 - slippagePercent / 100;
  return BigInt(Math.floor(Number(amountOut) * slippageFactor));
}
