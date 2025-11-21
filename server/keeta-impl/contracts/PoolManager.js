// src/contracts/PoolManager.js
import { Pool } from './Pool.js';
import { createStorageAccount } from '../utils/client.js';
import { getPairKey } from '../utils/constants.js';
import { PoolRepository } from '../db/pool-repository.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Manages all liquidity pools in the DEX
 * Handles pool creation, discovery, and routing
 */
export class PoolManager {
  constructor() {
    this.pools = new Map(); // pairKey -> Pool instance
    this.poolAddresses = new Map(); // pairKey -> pool address
    this.repository = new PoolRepository(); // PostgreSQL repository
    this.persistencePath = '.pools.json'; // Legacy file storage (fallback)
  }

  /**
   * Initialize the pool manager (load existing pools)
   */
  async initialize() {
    await this.loadPools();

    console.log(`✅ PoolManager initialized with ${this.pools.size} pools from database`);

    // Discover pools on-chain in background (non-blocking)
    // This ensures pools are synced with blockchain without blocking server startup
    this.discoverPoolsInBackground();

    return this;
  }

  /**
   * Run blockchain pool discovery in background (non-blocking)
   * Starts after a delay to allow server to become responsive first
   */
  discoverPoolsInBackground() {
    // Start discovery after 5 seconds (server is responsive immediately)
    setTimeout(async () => {
      console.log('🔍 Starting background blockchain pool discovery...');
      try {
        await this.discoverPoolsOnChain();
        console.log(`✅ Background pool discovery complete: ${this.pools.size} total pools`);
      } catch (err) {
        console.error('⚠️ Background pool discovery failed (non-critical):', err.message);
        console.log('   Server continues using database/file-based pool data');
      }
    }, 5000);
  }

  /**
   * Load pool addresses from PostgreSQL database
   */
  async loadPools() {
    try {
      const poolData = await this.repository.loadPools();

      for (const row of poolData) {
        // FILTER: Only load pools with LP tokens (ignore legacy pools)
        if (!row.lp_token_address) {
          console.log(`⏭️  Skipping legacy pool without LP token: ${row.pool_address.slice(-8)}`);
          continue;
        }

        const pairKey = getPairKey(row.token_a, row.token_b);
        this.poolAddresses.set(pairKey, row.pool_address);

        // Initialize pool instance with LP token address if available
        const pool = new Pool(
          row.pool_address,
          row.token_a,
          row.token_b,
          row.lp_token_address || null,
          null,  // opsClient
          this.repository  // repository
        );
        pool.creator = row.creator || null; // Set creator/owner
        await pool.initialize();
        this.pools.set(pairKey, pool);

        console.log(`📦 Loaded pool: ${pairKey} at ${row.pool_address}`);
      }
    } catch (err) {
      console.error('⚠️ Could not load pools from database:', err.message);
      // Fallback to file-based storage if database fails
      await this.loadPoolsFromFile();
    }
  }

  /**
   * Fallback: Load pool addresses from legacy .pools.json file
   */
  async loadPoolsFromFile() {
    try {
      const data = await fs.readFile(this.persistencePath, 'utf8');
      const poolData = JSON.parse(data);

      for (const [pairKey, poolInfo] of Object.entries(poolData)) {
        // FILTER: Only load pools with LP tokens (ignore legacy pools)
        if (!poolInfo.lpTokenAddress) {
          console.log(`⏭️  Skipping legacy pool without LP token: ${pairKey}`);
          continue;
        }

        this.poolAddresses.set(pairKey, poolInfo.address);

        // Initialize pool instance with LP token address if available
        const pool = new Pool(
          poolInfo.address,
          poolInfo.tokenA,
          poolInfo.tokenB,
          poolInfo.lpTokenAddress || null,
          null,  // opsClient
          this.repository  // repository
        );
        pool.creator = poolInfo.creator || null; // Set creator/owner
        await pool.initialize();
        this.pools.set(pairKey, pool);

        console.log(`📦 Loaded pool from file: ${pairKey} at ${poolInfo.address}`);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn('⚠️ Could not load pools from file:', err.message);
      }
    }
  }

  /**
   * Save single pool to PostgreSQL database
   */
  async savePool(pool) {
    try {
      await this.repository.savePool({
        poolAddress: pool.poolAddress,
        tokenA: pool.tokenA,
        tokenB: pool.tokenB,
        lpTokenAddress: pool.lpTokenAddress,
        creator: pool.creator || null,
      });
    } catch (err) {
      console.error('⚠️ Could not save pool to database:', err.message);
      throw err;
    }
  }

  /**
   * Legacy: Save pool addresses to .pools.json file
   */
  async savePools() {
    const poolData = {};

    for (const [pairKey, pool] of this.pools.entries()) {
      poolData[pairKey] = {
        address: pool.poolAddress,
        tokenA: pool.tokenA,
        tokenB: pool.tokenB,
        lpTokenAddress: pool.lpTokenAddress,
        creator: pool.creator || null, // Track pool creator/owner
      };
    }

    await fs.writeFile(this.persistencePath, JSON.stringify(poolData, null, 2));
  }

  /**
   * Discover pools on-chain by scanning for STORAGE accounts with SILVERBACK_POOL names
   * This allows automatic recovery if persistent storage (.pools.json) is lost
   */
  async discoverPoolsOnChain() {
    try {
      console.log('🔍 Discovering pools on-chain...');

      const { getOpsClient, accountFromAddress } = await import('../utils/client.js');
      const client = await getOpsClient();

      // Known pool addresses to check (cleared - no legacy pools)
      const KNOWN_POOL_ADDRESSES = [
        // Legacy pools removed - new pools will be created with LP tokens
      ];

      let discovered = 0;

      for (const poolAddress of KNOWN_POOL_ADDRESSES) {
        try {
          // Skip if already loaded
          if (this.getPoolByAddress(poolAddress)) {
            console.log(`  Pool ${poolAddress.slice(-8)} already loaded`);
            continue;
          }

          // Try to get balances to identify tokens
          const poolAccount = accountFromAddress(poolAddress);
          const balances = await client.allBalances({ account: poolAccount });

          if (!balances || balances.length < 2) {
            console.log(`  Pool ${poolAddress.slice(-8)} has insufficient tokens`);
            continue;
          }

          // Extract token addresses from balances
          const tokenAddresses = balances
            .map(b => {
              // Try different ways to get the token address
              const token = b.token?.publicKeyString?.get?.() ||
                           b.token?.publicKeyString?.toString() ||
                           b.token?.toString();
              return token;
            })
            .filter(addr => addr && addr.startsWith('keeta_'));

          if (tokenAddresses.length < 2) {
            console.log(`  Pool ${poolAddress.slice(-8)} has less than 2 valid tokens`);
            continue;
          }

          const [tokenA, tokenB] = tokenAddresses;
          const pairKey = getPairKey(tokenA, tokenB);

          // Skip if pair already exists (different address)
          if (this.pools.has(pairKey)) {
            console.log(`  Pair ${pairKey} already exists at different address`);
            continue;
          }

          // Create and initialize pool (discovered pools may not have LP tokens yet)
          const pool = new Pool(poolAddress, tokenA, tokenB, null, null, this.repository);
          await pool.initialize();

          this.pools.set(pairKey, pool);
          this.poolAddresses.set(pairKey, poolAddress);

          discovered++;

          // Get token symbols for logging
          const symbolA = await pool.getTokenSymbol(tokenA);
          const symbolB = await pool.getTokenSymbol(tokenB);

          console.log(`✅ Discovered pool: ${symbolA}/${symbolB} at ${poolAddress.slice(-8)}`);
        } catch (err) {
          console.warn(`⚠️ Error checking pool ${poolAddress.slice(-8)}:`, err.message);
        }
      }

      if (discovered > 0) {
        console.log(`🎉 Discovered ${discovered} new pools on-chain`);
        // Save discovered pools to database
        for (const pool of this.pools.values()) {
          try {
            await this.savePool(pool);
          } catch (err) {
            console.warn(`⚠️ Failed to save pool ${pool.poolAddress}:`, err.message);
          }
        }
      } else {
        console.log('✓ No new pools discovered');
      }
    } catch (error) {
      console.error('❌ Error discovering pools on-chain:', error);
    }
  }

  /**
   * Transfer pool ownership from Ops to creator
   * Ops maintains SEND_ON_BEHALF permissions to act as router
   *
   * @param {string} poolAddress - Pool storage account address
   * @param {string} creatorAddress - Creator's account address
   * @param {string} tokenA - First token address (not used currently)
   * @param {string} tokenB - Second token address (not used currently)
   */
  async transferPoolOwnership(poolAddress, creatorAddress, tokenA, tokenB) {
    const { getOpsClient, getOpsAccount, accountFromAddress, KeetaNet } = await import('../utils/client.js');

    const client = await getOpsClient();
    const ops = getOpsAccount();
    const builder = client.initBuilder();

    const poolAccount = accountFromAddress(poolAddress);
    const creatorAccount = accountFromAddress(creatorAddress);

    // Grant OWNER to creator
    builder.updatePermissions(
      creatorAccount,
      new KeetaNet.lib.Permissions(['OWNER']),
      undefined,
      undefined,
      { account: poolAccount }
    );

    // Update Ops permissions: keep SEND_ON_BEHALF plus STORAGE_DEPOSIT and ACCESS
    // These are needed to interact with token storage accounts within the pool
    builder.updatePermissions(
      ops,
      new KeetaNet.lib.Permissions(['SEND_ON_BEHALF', 'STORAGE_DEPOSIT', 'ACCESS']),
      undefined,
      undefined,
      { account: poolAccount }
    );

    await client.publishBuilder(builder);

    console.log(`✅ Transferred ownership of pool ${poolAddress.slice(0, 20)}... to ${creatorAddress.slice(0, 20)}...`);
    console.log(`   Ops retains SEND_ON_BEHALF permissions for routing`);
  }

  /**
   * Create a new pool for a token pair (permissionless)
   *
   * CENTRALIZED LIQUIDITY MODEL:
   * - OPS owns all pools (can publish TX2 to complete swaps)
   * - Any user can trade (TX1 only requires having tokens)
   * - Creator tracked for informational purposes
   *
   * @param {string} tokenA - Token A address
   * @param {string} tokenB - Token B address
   * @param {string} creatorAddress - Address of the pool creator (for tracking only)
   * @returns {Promise<Pool>}
   */
  async createPool(tokenA, tokenB, creatorAddress) {
    const pairKey = getPairKey(tokenA, tokenB);

    // Check if pool already exists
    if (this.pools.has(pairKey)) {
      throw new Error(`Pool already exists for ${pairKey}`);
    }

    console.log(`🏗️ Creating new pool for ${pairKey}...`);

    // Fetch token symbols for better on-chain description
    const { fetchTokenMetadata } = await import('../utils/client.js');
    const tokenAMeta = await fetchTokenMetadata(tokenA);
    const tokenBMeta = await fetchTokenMetadata(tokenB);
    const symbolA = tokenAMeta.symbol;
    const symbolB = tokenBMeta.symbol;

    console.log(`   Token A: ${symbolA}, Token B: ${symbolB}`);

    // Create storage account for the pool
    // Creator owns the pool, OPS has routing permissions (SEND_ON_BEHALF only)
    const poolAddress = await createStorageAccount(
      'SILVERBACK_POOL',
      `Liquidity pool for ${symbolA} / ${symbolB}`,
      true, // isPool flag - enables SEND_ON_BEHALF for permissionless swaps
      creatorAddress // Creator owns the pool
    );

    console.log(`✅ Pool created at ${poolAddress}`);
    console.log(`   ✅ Creator owns pool: ${creatorAddress.slice(0, 20)}...`);
    console.log(`   ✅ OPS has routing permissions (SEND_ON_BEHALF)`);

    // Create LP token for this pool
    console.log(`   Creating LP token for pool...`);
    const { createLPToken } = await import('../utils/client.js');
    const lpTokenAddress = await createLPToken(poolAddress, tokenA, tokenB);
    console.log(`   ✅ LP token created: ${lpTokenAddress}`);

    // Create and initialize pool instance with LP token
    const pool = new Pool(poolAddress, tokenA, tokenB, null, this.repository);
    pool.creator = creatorAddress; // Track who created the pool
    pool.lpTokenAddress = lpTokenAddress; // Store LP token address
    await pool.initialize();

    // Register pool
    this.pools.set(pairKey, pool);
    this.poolAddresses.set(pairKey, poolAddress);

    // Persist to database (including LP token address) - non-critical
    let dbSaved = false;
    try {
      await this.savePool(pool);
      console.log(`✅ Pool saved to database`);
      dbSaved = true;
    } catch (dbError) {
      console.warn(`⚠️ Could not save pool to database (non-critical):`, dbError.message);
      console.log(`   Pool created successfully on-chain, database sync skipped`);
    }

    // Always save to .pools.json as fallback (ensures persistence across restarts)
    try {
      await this.savePools();
      console.log(`✅ Pool saved to .pools.json${dbSaved ? '' : ' (database unavailable)'}`);
    } catch (fileError) {
      console.error(`❌ Failed to save pools to .pools.json:`, fileError.message);
    }

    return pool;
  }

  /**
   * Get a pool by token pair
   * 
   * @param {string} tokenA
   * @param {string} tokenB
   * @returns {Pool | null}
   */
  getPool(tokenA, tokenB) {
    const pairKey = getPairKey(tokenA, tokenB);
    return this.pools.get(pairKey) || null;
  }

  /**
   * Get pool by address
   */
  getPoolByAddress(poolAddress) {
    for (const pool of this.pools.values()) {
      if (pool.poolAddress === poolAddress) {
        return pool;
      }
    }
    return null;
  }

  /**
   * Get all pools
   */
  getAllPools() {
    return Array.from(this.pools.values());
  }

  /**
   * Get pool info for all pools
   */
  async getAllPoolsInfo() {
    const poolsInfo = [];

    for (const pool of this.pools.values()) {
      // FILTER: Only return pools with LP tokens (ignore legacy pools without LP token address)
      if (!pool.lpTokenAddress) {
        console.log(`⏭️  Skipping legacy pool without LP token: ${pool.poolAddress.slice(-8)}`);
        continue;
      }

      const info = await pool.getPoolInfo();
      poolsInfo.push(info);
    }

    return poolsInfo;
  }

  /**
   * Find best route for a swap (simple implementation - direct swap only)
   * In future, this could handle multi-hop swaps
   * 
   * @param {string} tokenIn
   * @param {string} tokenOut
   * @returns {Pool | null}
   */
  findSwapRoute(tokenIn, tokenOut) {
    // For now, just return direct pool if it exists
    return this.getPool(tokenIn, tokenOut);
  }

  /**
   * Execute a swap (finds route automatically)
   *
   * @param {Object} userClient - User's KeetaNet client (from createUserClient)
   * @param {string} userAddress
   * @param {string} tokenIn
   * @param {string} tokenOut
   * @param {bigint} amountIn
   * @param {bigint} minAmountOut
   */
  async swap(userClient, userAddress, tokenIn, tokenOut, amountIn, minAmountOut = 0n) {
    const pool = this.findSwapRoute(tokenIn, tokenOut);

    if (!pool) {
      throw new Error(`No pool found for ${tokenIn} -> ${tokenOut}`);
    }

    return await pool.swap(userClient, userAddress, tokenIn, amountIn, minAmountOut);
  }

  /**
   * Get swap quote (without executing)
   */
  async getSwapQuote(tokenIn, tokenOut, amountIn) {
    const pool = this.findSwapRoute(tokenIn, tokenOut);
    
    if (!pool) {
      throw new Error(`No pool found for ${tokenIn} -> ${tokenOut}`);
    }
    
    return await pool.getSwapQuote(tokenIn, amountIn);
  }

  /**
   * Add liquidity to a pool
   * @param {Object} userClient - User's KeetaNet client (from createUserClient)
   * @param {string} userAddress - User's account address
   */
  async addLiquidity(
    userClient,
    userAddress,
    tokenA,
    tokenB,
    amountADesired,
    amountBDesired,
    amountAMin = 0n,
    amountBMin = 0n
  ) {
    const pool = this.getPool(tokenA, tokenB);

    if (!pool) {
      throw new Error(`No pool found for ${tokenA} / ${tokenB}`);
    }

    return await pool.addLiquidity(
      userClient,
      userAddress,
      amountADesired,
      amountBDesired,
      amountAMin,
      amountBMin
    );
  }

  /**
   * Remove liquidity from a pool
   */
  async removeLiquidity(
    userClient,
    userAddress,
    tokenA,
    tokenB,
    liquidity,
    amountAMin = 0n,
    amountBMin = 0n
  ) {
    let pool = this.getPool(tokenA, tokenB);

    // If pool not loaded or doesn't have repository, try to load from database
    if (!pool || !pool.repository) {
      const pairKey = getPairKey(tokenA, tokenB);

      try {
        const poolData = await this.repository.getPoolByPairKey(tokenA, tokenB);

        if (poolData) {
          console.log(`📥 Loading pool on-demand for remove liquidity: ${poolData.pool_address.slice(-8)}`);

          const { Pool } = await import('./Pool.js');
          pool = new Pool(
            poolData.pool_address,
            tokenA,
            tokenB,
            poolData.lp_token_address || null,
            this.opsClient,
            this.repository
          );
          pool.creator = poolData.creator || null;

          await pool.initialize();
          this.pools.set(pairKey, pool);
        }
      } catch (dbError) {
        console.warn(`⚠️ Could not load pool from database:`, dbError.message);

        // Fallback to .pools.json if database fails
        try {
          const data = await fs.readFile(this.persistencePath, 'utf8');
          const poolsData = JSON.parse(data);
          const poolInfo = poolsData[pairKey];

          if (poolInfo) {
            console.log(`📥 Loading pool from .pools.json fallback: ${poolInfo.address.slice(-8)}`);

            const { Pool } = await import('./Pool.js');
            pool = new Pool(
              poolInfo.address,
              poolInfo.tokenA,
              poolInfo.tokenB,
              poolInfo.lpTokenAddress || null,
              this.opsClient,
              this.repository
            );
            pool.creator = poolInfo.creator || null;

            await pool.initialize();
            this.pools.set(pairKey, pool);
          }
        } catch (fileError) {
          console.warn(`⚠️ Could not load pool from .pools.json:`, fileError.message);
        }
      }
    }

    if (!pool) {
      throw new Error(`Pool not found for ${tokenA} / ${tokenB}. Pool may need to be registered.`);
    }

    return await pool.removeLiquidity(userClient, userAddress, liquidity, amountAMin, amountBMin);
  }

  /**
   * Get user's LP positions across all pools
   * BLOCKCHAIN-FIRST: Scans user's wallet for LP tokens, derives positions from metadata
   * Database is only used as fallback for additional metadata
   */
  async getUserPositions(userAddress) {
    const positions = [];

    console.log(`📊 Scanning ${userAddress} wallet for LP tokens (blockchain-first)...`);

    try {
      const { accountFromAddress, getOpsClient } = await import('../utils/client.js');
      const client = await getOpsClient();
      const userAccount = accountFromAddress(userAddress);

      // Query user's token balances from blockchain (real-time data!)
      const userBalances = await client.allBalances({ account: userAccount });

      console.log(`📋 Found ${userBalances.length} tokens in wallet, scanning for LP tokens...`);

      // Scan user's balances for LP tokens
      for (const balance of userBalances) {
        try {
          const tokenAddr = balance.token?.publicKeyString?.get?.() || balance.token?.toString();
          const shares = BigInt(balance.balance || 0n);

          if (shares <= 0n) {
            continue; // Skip zero balances
          }

          // Get token metadata to check if it's an LP token
          const tokenInfo = await client.client.getAccountsInfo([tokenAddr]);
          const tokenData = tokenInfo[tokenAddr];

          if (!tokenData?.info?.metadata) {
            continue; // Not an LP token (no metadata)
          }

          // Decode metadata
          let metadata;
          try {
            const metadataStr = Buffer.from(tokenData.info.metadata, 'base64').toString('utf8');
            metadata = JSON.parse(metadataStr);
          } catch (e) {
            continue; // Invalid metadata format
          }

          // Check if this is an LP token
          if (metadata.type !== 'LP_TOKEN') {
            continue; // Not an LP token
          }

          console.log(`  🪙 Found LP token: ${tokenAddr.slice(0, 20)}... with ${shares} shares`);
          console.log(`     Pool: ${metadata.pool?.slice(0, 20)}...`);

          // Extract pool info from LP token metadata
          const poolAddress = metadata.pool;
          const tokenA = metadata.tokenA;
          const tokenB = metadata.tokenB;

          if (!poolAddress || !tokenA || !tokenB) {
            console.log(`     ⚠️ Missing pool metadata, skipping`);
            continue;
          }

          // Load pool instance
          let pool = this.getPool(tokenA, tokenB);

          // If pool not loaded yet, load it on-demand
          if (!pool) {
            console.log(`     📥 Loading pool from blockchain...`);
            try {
              const { Pool } = await import('./Pool.js');
              pool = new Pool(
                poolAddress,
                tokenA,
                tokenB,
                this.opsClient,
                this.repository
              );

              // Load pool state from blockchain
              await pool.loadState();

              // Store in manager for future use
              const pairKey = getPairKey(tokenA, tokenB);
              this.pools.set(pairKey, pool);

              console.log(`     ✅ Pool loaded: ${poolAddress.slice(-8)}`);
            } catch (loadError) {
              console.error(`     ❌ Failed to load pool ${poolAddress.slice(-8)}:`, loadError.message);
              continue;
            }
          }

          // Get LP token total supply
          const lpTokenInfo = await client.client.getAccountsInfo([tokenAddr]);
          const lpData = lpTokenInfo[tokenAddr];
          const totalShares = lpData?.info?.supply ? BigInt(lpData.info.supply) : 0n;

          console.log(`     Total LP supply: ${totalShares}`);

          // Calculate share percentage
          const sharePercent = totalShares > 0n
            ? Number((shares * 10000n) / totalShares) / 100
            : 0;

          // Calculate amounts from shares and current reserves (dynamic calculation)
          const { calculateAmountsForLPBurn } = await import('../utils/math.js');
          const { amountA, amountB } = calculateAmountsForLPBurn(
            shares,
            totalShares,
            pool.reserveA,
            pool.reserveB
          );

          // Get token symbols
          const symbolA = await pool.getTokenSymbol(pool.tokenA);
          const symbolB = await pool.getTokenSymbol(pool.tokenB);

          // Use cached decimals from pool object (fetched during pool initialization)
          const decimalsA = pool.decimalsA;
          const decimalsB = pool.decimalsB;

          // Format amounts removing trailing zeros for better display
          const amountANum = Number(amountA) / Math.pow(10, decimalsA);
          const amountBNum = Number(amountB) / Math.pow(10, decimalsB);

          // Use toFixed for precision, then parseFloat to remove trailing zeros
          const amountAFormatted = parseFloat(amountANum.toFixed(Math.min(decimalsA, 6))).toString();
          const amountBFormatted = parseFloat(amountBNum.toFixed(Math.min(decimalsB, 6))).toString();

          positions.push({
            poolAddress: pool.poolAddress,
            lpTokenAddress: tokenAddr, // LP token address needed for remove liquidity
            tokenA: pool.tokenA,
            tokenB: pool.tokenB,
            symbolA,
            symbolB,
            liquidity: shares.toString(),
            sharePercent,
            amountA: amountAFormatted,
            amountB: amountBFormatted,
            timestamp: Date.now(),
          });

          console.log(`     ✅ Position added: ${sharePercent.toFixed(2)}% of ${symbolA}/${symbolB} pool`);
        } catch (error) {
          console.error(`  ❌ Error processing token balance:`, error.message);
          // Continue to next balance instead of failing completely
        }
      }
    } catch (error) {
      console.error(`Error querying user LP tokens from blockchain:`, error.message);
      // Return empty array on error
    }

    console.log(`✅ Found ${positions.length} LP positions on-chain (blockchain-first!)`);
    return positions;
  }

  /**
   * Check if pool exists
   */
  hasPool(tokenA, tokenB) {
    const pairKey = getPairKey(tokenA, tokenB);
    return this.pools.has(pairKey);
  }

  /**
   * Get statistics for a pool
   */
  async getPoolStats(tokenA, tokenB) {
    const pool = this.getPool(tokenA, tokenB);

    if (!pool) {
      throw new Error(`No pool found for ${tokenA} / ${tokenB}`);
    }

    const info = await pool.getPoolInfo();

    // Calculate TVL, APY, and Volume using APYCalculator
    const { APYCalculator } = await import('../utils/apy-calculator.js');
    const apyCalculator = new APYCalculator();
    const apyData = await apyCalculator.calculatePoolAPY(
      pool.poolAddress,
      pool.reserveA,
      pool.reserveB,
      pool.decimalsA,
      pool.decimalsB,
      pool.tokenA,
      pool.tokenB
    );

    return {
      ...info,
      tvl: apyData.tvl,
      volume24h: apyData.volume24h,
      apy: apyData.apy,
      fees24h: apyData.volume24h * 0.003, // 0.3% total fees
      lpHolders: 0, // TODO: Track total LP holders count from LP token
    };
  }
}

// Singleton instance
let poolManagerInstance = null;

/**
 * Get the singleton PoolManager instance
 */
export async function getPoolManager() {
  if (!poolManagerInstance) {
    poolManagerInstance = new PoolManager();
    await poolManagerInstance.initialize();
  }
  return poolManagerInstance;
}
