// Keythings wallet liquidity endpoint
// Completes add liquidity after user has sent tokens via TX1 (signed in Keythings)
import express from 'express';
import { getPoolManager } from '../contracts/PoolManager.js';
import { getOpsClient, accountFromAddress, mintLPTokens } from '../utils/client.js';
import { toAtomic } from '../utils/constants.js';
import { fetchTokenDecimals } from '../utils/client.js';
import { markTX2Complete, markTX2Failed } from '../db/transaction-state.js';

const router = express.Router();

/**
 * Helper: Load pool on-demand if not in memory
 * Prevents "Pool not found" errors when async pool discovery is still running
 */
async function getPoolInstance(poolManager, poolAddress) {
  // Check in-memory first
  let pool = Array.from(poolManager.pools.values()).find(
    (p) => p.poolAddress === poolAddress
  );

  // If not in memory, load from database on-demand
  if (!pool) {
    console.log(`⚠️ Pool ${poolAddress.slice(-8)} not in memory, loading from database...`);

    try {
      const poolData = await poolManager.repository.getPoolByAddress(poolAddress);

      if (poolData) {
        const { Pool } = await import('../contracts/Pool.js');
        const { getPairKey } = await import('../utils/constants.js');

        pool = new Pool(
          poolData.pool_address,
          poolData.token_a,
          poolData.token_b,
          poolData.lp_token_address,
          null,
          poolManager.repository
        );
        await pool.initialize();

        // Cache it for future requests
        const pairKey = getPairKey(poolData.token_a, poolData.token_b);
        poolManager.pools.set(pairKey, pool);

        console.log(`✅ Pool loaded on-demand: ${poolAddress.slice(-8)}`);
      }
    } catch (dbError) {
      console.error(`❌ Failed to load pool from database:`, dbError);
    }
  }

  if (!pool) {
    throw new Error(`Pool not found in memory or database: ${poolAddress}`);
  }

  return pool;
}

/**
 * POST /api/liquidity/keythings/complete
 * Complete a Keythings wallet add liquidity by minting LP tokens to user
 *
 * Flow:
 * 1. User already sent TX1 via Keythings (tokenA + tokenB → pool)
 * 2. This endpoint executes TX2: mint LP tokens to user using OPS account
 *
 * Body: {
 *   userAddress: string,
 *   poolAddress: string,
 *   tokenA: string,
 *   tokenB: string,
 *   amountA: string (atomic units as string),
 *   amountB: string (atomic units as string)
 * }
 */
router.post('/complete', async (req, res) => {
  const { transactionId } = req.body; // Optional: for transaction tracking

  try {
    console.log('💧 Keythings add liquidity /complete endpoint called');
    console.log('📦 Request body:', JSON.stringify(req.body, null, 2));

    const { userAddress, poolAddress, tokenA, tokenB, amountA, amountB } = req.body;

    if (!userAddress || !poolAddress || !tokenA || !tokenB || !amountA || !amountB) {
      console.error('❌ Missing required fields!');
      console.error('   Received:', { userAddress: !!userAddress, poolAddress: !!poolAddress, tokenA: !!tokenA, tokenB: !!tokenB, amountA: !!amountA, amountB: !!amountB });
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userAddress, poolAddress, tokenA, tokenB, amountA, amountB',
        received: req.body,
      });
    }

    console.log('✅ All required fields present');
    console.log(`   User: ${userAddress.slice(0, 12)}...`);
    console.log(`   Pool: ${poolAddress.slice(0, 12)}...`);
    console.log(`   Token A: ${tokenA.slice(0, 12)}...`);
    console.log(`   Token B: ${tokenB.slice(0, 12)}...`);
    console.log(`   Amount A: ${amountA}`);
    console.log(`   Amount B: ${amountB}`);

    const opsClient = await getOpsClient();
    const poolManager = await getPoolManager();

    // Find or load the pool instance (with on-demand loading)
    const pool = await getPoolInstance(poolManager, poolAddress);

    // Get current reserves to calculate LP shares
    await pool.updateReserves();
    const reserveA = pool.reserveA;
    const reserveB = pool.reserveB;

    // Ensure LP token address is available before fetching total supply
    if (!pool.lpTokenAddress) {
      console.log('⚠️ LP token address not set on pool, looking up from database...');
      // Look up LP token from database
      const poolData = await poolManager.repository.getPoolByAddress(poolAddress);
      if (poolData && poolData.lp_token_address) {
        pool.lpTokenAddress = poolData.lp_token_address;
        console.log(`   Found LP token in database: ${pool.lpTokenAddress}`);
      }

      if (!pool.lpTokenAddress) {
        throw new Error('LP token address not found for pool. Pool may need to be recreated.');
      }
    }

    // Fetch total supply from LP token account
    let totalSupply = 0n;
    try {
      const lpTokenAccountInfo = await opsClient.client.getAccountsInfo([pool.lpTokenAddress]);
      const lpTokenInfo = lpTokenAccountInfo[pool.lpTokenAddress];

      if (lpTokenInfo?.info?.supply) {
        totalSupply = BigInt(lpTokenInfo.info.supply);
      }
    } catch (err) {
      console.warn('⚠️ Could not fetch LP token supply, assuming first liquidity:', err.message);
      totalSupply = 0n;
    }

    console.log('📊 Current pool state:', {
      reserveA: reserveA.toString(),
      reserveB: reserveB.toString(),
      totalSupply: totalSupply.toString(),
    });

    // Calculate LP shares to mint
    const amountABigInt = BigInt(amountA);
    const amountBBigInt = BigInt(amountB);

    let liquidity;
    if (totalSupply === 0n) {
      // First liquidity - geometric mean minus MINIMUM_LIQUIDITY
      const MINIMUM_LIQUIDITY = 1000n;
      liquidity = sqrt(amountABigInt * amountBBigInt) - MINIMUM_LIQUIDITY;
      console.log('🆕 First liquidity provision');
    } else {
      // Subsequent liquidity - proportional to reserves
      const liquidityA = (amountABigInt * totalSupply) / reserveA;
      const liquidityB = (amountBBigInt * totalSupply) / reserveB;
      liquidity = liquidityA < liquidityB ? liquidityA : liquidityB;
      console.log('➕ Adding to existing liquidity');
    }

    console.log(`💎 LP shares to mint: ${liquidity}`);

    if (liquidity <= 0n) {
      throw new Error('Insufficient liquidity minted');
    }

    // TX2: Mint LP tokens to user
    console.log('📝 TX2: Minting LP tokens to user...');
    console.log(`   Pool instance lpTokenAddress: ${pool.lpTokenAddress || 'NOT SET'}`);

    // Ensure LP token address is available
    if (!pool.lpTokenAddress) {
      console.log('⚠️ LP token address not set on pool, looking up from database...');
      // Look up LP token from database
      const poolData = await poolManager.repository.getPoolByAddress(poolAddress);
      console.log(`   Database query returned:`, poolData ? `pool found` : `NULL`);
      if (poolData && poolData.lp_token_address) {
        pool.lpTokenAddress = poolData.lp_token_address;
        console.log(`   Found LP token in database: ${pool.lpTokenAddress}`);
      } else if (poolData) {
        console.error(`   ❌ Pool exists in database but lp_token_address is NULL!`);
        console.error(`   Pool data:`, JSON.stringify(poolData, null, 2));
      }

      if (!pool.lpTokenAddress) {
        throw new Error('LP token address not found for pool. Pool may need to be recreated.');
      }
    }

    console.log(`   Calling mintLPTokens with:`);
    console.log(`     - LP Token: ${pool.lpTokenAddress}`);
    console.log(`     - Recipient: ${userAddress}`);
    console.log(`     - Amount: ${liquidity}`);

    // Use the mintLPTokens helper which:
    // 1. modifyTokenSupply() to create new tokens
    // 2. send() to transfer them to the user
    try {
      await mintLPTokens(pool.lpTokenAddress, userAddress, liquidity);
      console.log(`✅ TX2 completed: ${liquidity} LP tokens minted to user`);
    } catch (mintError) {
      console.error(`❌ mintLPTokens FAILED:`, mintError.message);
      console.error(`   Stack:`, mintError.stack);
      throw mintError;
    }

    // Update pool reserves and total supply
    pool.reserveA = reserveA + amountABigInt;
    pool.reserveB = reserveB + amountBBigInt;
    pool.totalSupply = totalSupply + liquidity;

    // Save LP position to database
    await poolManager.repository.saveLPPosition(
      poolAddress,
      userAddress,
      liquidity
    );

    console.log('💾 Saved LP position to database');

    // Get decimals for human-readable response
    const decimalsA = await fetchTokenDecimals(tokenA);
    const decimalsB = await fetchTokenDecimals(tokenB);

    // Track TX2 completion (if transaction tracking enabled)
    if (transactionId) {
      try {
        await markTX2Complete(transactionId, 'lp_minted');
      } catch (trackingError) {
        console.warn('⚠️ Failed to track TX2 completion (non-critical):', trackingError.message);
      }
    }

    res.json({
      success: true,
      result: {
        liquidity: liquidity.toString(),
        amountA: (Number(amountA) / Math.pow(10, decimalsA)).toString(),
        amountB: (Number(amountB) / Math.pow(10, decimalsB)).toString(),
        newReserveA: (Number(pool.reserveA) / Math.pow(10, decimalsA)).toString(),
        newReserveB: (Number(pool.reserveB) / Math.pow(10, decimalsB)).toString(),
      },
    });
  } catch (error) {
    console.error('❌ Keythings add liquidity completion error:', error);

    // Track TX2 failure (if transaction tracking enabled)
    if (transactionId) {
      try {
        await markTX2Failed(transactionId, error.message);
      } catch (trackingError) {
        console.warn('⚠️ Failed to track TX2 failure (non-critical):', trackingError.message);
      }
    }

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Integer square root (for first liquidity calculation)
 * @param {bigint} value
 * @returns {bigint}
 */
function sqrt(value) {
  if (value < 0n) {
    throw new Error('Square root of negative numbers is not supported');
  }
  if (value < 2n) {
    return value;
  }

  function newtonIteration(n, x0) {
    const x1 = (n / x0 + x0) >> 1n;
    if (x0 === x1 || x0 === x1 - 1n) {
      return x0;
    }
    return newtonIteration(n, x1);
  }

  return newtonIteration(value, 1n);
}

/**
 * POST /api/liquidity/keythings/remove-complete
 * Complete a Keythings wallet remove liquidity by burning LP tokens and returning tokens to user
 *
 * Flow:
 * 1. User already sent TX1 via Keythings (LP tokens → pool for burning)
 * 2. This endpoint executes TX2: burn LP tokens and send tokenA + tokenB to user using OPS account
 *
 * Body: {
 *   userAddress: string,
 *   poolAddress: string,
 *   lpTokenAddress: string,
 *   lpAmount: string (atomic units as string),
 *   amountAMin: string (atomic units as string),
 *   amountBMin: string (atomic units as string)
 * }
 */
router.post('/remove-complete', async (req, res) => {
  const { transactionId } = req.body; // Optional: for transaction tracking

  try {
    console.log('🔥 Keythings remove liquidity /remove-complete endpoint called');
    console.log('📦 Request body:', JSON.stringify(req.body, null, 2));

    const { userAddress, poolAddress, lpTokenAddress, lpAmount, amountAMin, amountBMin } = req.body;

    if (!userAddress || !poolAddress || !lpTokenAddress || !lpAmount) {
      console.error('❌ Missing required fields!');
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userAddress, poolAddress, lpTokenAddress, lpAmount',
        received: req.body,
      });
    }

    console.log('✅ All required fields present');
    console.log(`   User: ${userAddress.slice(0, 12)}...`);
    console.log(`   Pool: ${poolAddress.slice(0, 12)}...`);
    console.log(`   LP Token: ${lpTokenAddress.slice(0, 12)}...`);
    console.log(`   LP Amount: ${lpAmount}`);

    const opsClient = await getOpsClient();
    const poolManager = await getPoolManager();

    // Find or load the pool instance (with on-demand loading)
    const pool = await getPoolInstance(poolManager, poolAddress);

    // Update reserves to get current state
    await pool.updateReserves();
    const reserveA = pool.reserveA;
    const reserveB = pool.reserveB;

    // Get total LP supply
    let totalSupply = 0n;
    try {
      const lpTokenAccountInfo = await opsClient.client.getAccountsInfo([lpTokenAddress]);
      const lpTokenInfo = lpTokenAccountInfo[lpTokenAddress];

      if (lpTokenInfo?.info?.supply) {
        totalSupply = BigInt(lpTokenInfo.info.supply);
      }
    } catch (err) {
      throw new Error(`Could not fetch LP token supply: ${err.message}`);
    }

    console.log('📊 Current pool state:', {
      reserveA: reserveA.toString(),
      reserveB: reserveB.toString(),
      totalSupply: totalSupply.toString(),
    });

    // Calculate amounts to return
    const lpAmountBigInt = BigInt(lpAmount);
    const amountA = (lpAmountBigInt * reserveA) / totalSupply;
    const amountB = (lpAmountBigInt * reserveB) / totalSupply;

    console.log(`💎 Tokens to return: ${amountA} tokenA + ${amountB} tokenB`);

    // Check minimum amounts
    const amountAMinBigInt = amountAMin ? BigInt(amountAMin) : 0n;
    const amountBMinBigInt = amountBMin ? BigInt(amountBMin) : 0n;

    if (amountA < amountAMinBigInt) {
      throw new Error(`Insufficient tokenA: got ${amountA}, minimum ${amountAMinBigInt}`);
    }
    if (amountB < amountBMinBigInt) {
      throw new Error(`Insufficient tokenB: got ${amountB}, minimum ${amountBMinBigInt}`);
    }

    // TX2: Burn LP tokens and return tokens to user
    console.log('📝 TX2: Burning LP tokens and returning tokens to user...');

    // Import KeetaNet for account creation
    const KeetaNet = await import('@keetanetwork/keetanet-client');
    const lpTokenAccount = KeetaNet.lib.Account.fromPublicKeyString(lpTokenAddress);
    const poolAccount = KeetaNet.lib.Account.fromPublicKeyString(poolAddress);
    const userAccount = KeetaNet.lib.Account.fromPublicKeyString(userAddress);
    const tokenAAccount = KeetaNet.lib.Account.fromPublicKeyString(pool.tokenA);
    const tokenBAccount = KeetaNet.lib.Account.fromPublicKeyString(pool.tokenB);

    // Burn the LP tokens by reducing supply using modifyTokenSupply with negative amount
    const burnBuilder = opsClient.initBuilder();
    burnBuilder.modifyTokenSupply(-lpAmountBigInt, { account: lpTokenAccount });
    await opsClient.publishBuilder(burnBuilder);
    console.log(`🔥 Burned ${lpAmountBigInt} LP tokens`);

    // Send tokenA and tokenB from pool to user
    const sendBuilder = opsClient.initBuilder();

    // Send tokenA from pool to user
    sendBuilder.send(
      userAccount,
      amountA,
      tokenAAccount,
      undefined,
      { account: poolAccount }
    );

    // Send tokenB from pool to user
    sendBuilder.send(
      userAccount,
      amountB,
      tokenBAccount,
      undefined,
      { account: poolAccount }
    );

    await opsClient.publishBuilder(sendBuilder);

    console.log(`✅ TX2 completed: returned ${amountA} tokenA + ${amountB} tokenB to user`);

    // Update pool reserves and total supply (in-memory only, blockchain is source of truth)
    pool.reserveA = reserveA - amountA;
    pool.reserveB = reserveB - amountB;
    pool.totalSupply = totalSupply - lpAmountBigInt;

    // Get decimals for human-readable response
    const decimalsA = await fetchTokenDecimals(pool.tokenA);
    const decimalsB = await fetchTokenDecimals(pool.tokenB);

    // Track TX2 completion (if transaction tracking enabled)
    if (transactionId) {
      try {
        await markTX2Complete(transactionId, 'lp_burned');
      } catch (trackingError) {
        console.warn('⚠️ Failed to track TX2 completion (non-critical):', trackingError.message);
      }
    }

    res.json({
      success: true,
      result: {
        amountA: (Number(amountA) / Math.pow(10, decimalsA)).toString(),
        amountB: (Number(amountB) / Math.pow(10, decimalsB)).toString(),
        lpBurned: lpAmount,
        newReserveA: (Number(pool.reserveA) / Math.pow(10, decimalsA)).toString(),
        newReserveB: (Number(pool.reserveB) / Math.pow(10, decimalsB)).toString(),
      },
    });
  } catch (error) {
    console.error('❌ Keythings remove liquidity completion error:', error);

    // Track TX2 failure (if transaction tracking enabled)
    if (transactionId) {
      try {
        await markTX2Failed(transactionId, error.message);
      } catch (trackingError) {
        console.warn('⚠️ Failed to track TX2 failure (non-critical):', trackingError.message);
      }
    }

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
