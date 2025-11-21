// src/contracts/Pool.js
import {
  getOpsClient,
  getTreasuryAccount,
  getOpsAccount,
  getBalances,
  accountFromAddress,
  fetchTokenDecimals,
  createLPStorageAccount,
  updateLPMetadata,
  readLPMetadata,
  fetchTokenMetadata,
  mintLPTokens,
  burnLPTokens,
  getLPTokenBalance,
} from '../utils/client.js';
import {
  calculateSwapOutput,
  calculateOptimalLiquidityAmounts,
  calculateLPTokensToMint,
  calculateAmountsForLPBurn,
  calculatePrice,
  calculateMinAmountOut,
} from '../utils/math.js';
import { CONFIG, toAtomic, fromAtomic } from '../utils/constants.js';

/**
 * Represents a liquidity pool for a token pair
 *
 * ARCHITECTURE: Multi-LP with individual storage accounts
 * - Pool = Coordinator account (tracks all LP storage accounts)
 * - Each LP has their own STORAGE account (user-owned, ops can route)
 * - Aggregated reserves from all LP accounts for unified pricing
 * - Permissionless: users control their own funds
 */
export class Pool {
  constructor(poolAddress, tokenA, tokenB, lpTokenAddress = null, opsClient = null, repository = null) {
    this.poolAddress = poolAddress; // Pool coordinator address
    this.tokenA = tokenA; // Token address
    this.tokenB = tokenB; // Token address
    this.lpTokenAddress = lpTokenAddress; // Fungible LP token address (ERC-20 style)
    this.decimalsA = null;
    this.decimalsB = null;
    this.reserveA = 0n; // Aggregated from all LP accounts
    this.reserveB = 0n; // Aggregated from all LP accounts
    this.creator = null; // Pool creator/owner (for simple architecture)

    // Multi-LP tracking (DEPRECATED - LP tokens are now used instead)
    // Kept for backward compatibility and migration
    this.lpAccounts = new Map(); // userAddress => { lpStorageAddress, shares }
    this.totalShares = 0n;

    // Database repository for LP positions (PostgreSQL source of truth)
    this.repository = repository;
    this.opsClient = opsClient;
  }

  /**
   * Initialize pool by fetching reserves and token info
   * Uses graceful degradation - starts with defaults if network fails
   */
  async initialize() {
    // Start with sensible defaults
    this.decimalsA = 9; // Default for most Keeta tokens
    this.decimalsB = 9;
    this.reserveA = 0n;
    this.reserveB = 0n;
    this.lpAccounts = new Map();
    this.totalShares = 0n;

    // Try to fetch real data, but don't block initialization
    // This runs in background and updates values when available
    this.fetchPoolDataInBackground();

    // Load liquidity positions from file (this doesn't require network, but don't block)
    this.loadLiquidityPositions().catch(err => {
      console.warn(`⚠️ Could not load LP positions for pool ${this.poolAddress.slice(-8)}: ${err.message}`);
    });

    return this;
  }

  /**
   * Fetch pool data in background without blocking initialization
   */
  async fetchPoolDataInBackground() {
    try {
      // Fetch token decimals
      const [decimalsA, decimalsB] = await Promise.all([
        fetchTokenDecimals(this.tokenA).catch(() => 9),
        fetchTokenDecimals(this.tokenB).catch(() => 9),
      ]);
      this.decimalsA = decimalsA;
      this.decimalsB = decimalsB;

      // Fetch current reserves
      await this.updateReserves().catch(err => {
        console.warn(`⚠️ Could not fetch reserves for pool ${this.poolAddress.slice(-8)}: ${err.message}`);
      });

      console.log(`✅ Pool ${this.poolAddress.slice(-8)} data fetched successfully`);
    } catch (err) {
      console.warn(`⚠️ Background fetch failed for pool ${this.poolAddress.slice(-8)}: ${err.message}`);
    }
  }

  /**
   * Load liquidity positions from JSON file
   * SIMPLIFIED: Only loads shares, amounts calculated on-demand from current reserves
   */
  async loadLiquidityPositions() {
    try {
      const fs = await import('fs/promises');
      const filePath = `.liquidity-positions-${this.poolAddress.slice(-8)}.json`;
      const data = await fs.readFile(filePath, 'utf8');
      const positions = JSON.parse(data);

      // Convert positions object back to Map with BigInt values
      // Only store shares - amounts will be calculated from current reserves
      this.lpAccounts = new Map();
      for (const [userAddress, position] of Object.entries(positions.positions || {})) {
        this.lpAccounts.set(userAddress, {
          lpStorageAddress: position.lpStorageAddress || null,
          shares: BigInt(position.shares),
        });
      }

      this.totalShares = BigInt(positions.totalShares || '0');
    } catch (err) {
      // File doesn't exist, start fresh
      this.lpAccounts = new Map();
      this.totalShares = 0n;
    }
  }

  /**
   * Save liquidity positions to JSON file
   * SIMPLIFIED: Only saves shares, amounts calculated on-demand from current reserves
   */
  async saveLiquidityPositions() {
    const fs = await import('fs/promises');
    const filePath = `.liquidity-positions-${this.poolAddress.slice(-8)}.json`;

    const positions = {
      poolAddress: this.poolAddress,
      totalShares: this.totalShares.toString(),
      positions: Object.fromEntries(
        Array.from(this.lpAccounts.entries()).map(([addr, pos]) => [
          addr,
          {
            lpStorageAddress: pos.lpStorageAddress,
            shares: pos.shares.toString(),
            // amountA and amountB removed - calculated from current reserves on-demand
          }
        ])
      )
    };

    await fs.writeFile(filePath, JSON.stringify(positions, null, 2));
  }

  /**
   * Update reserves from on-chain balances (reads directly from pool account)
   */
  async updateReserves() {
    // If an update is already in progress, wait for it and return its result
    if (this._updatePromise) {
      return this._updatePromise;
    }

    // Create a new update promise
    this._updatePromise = (async () => {
      try {
        // Read balances directly from the pool account (not LP storage accounts)
        console.log(`📊 Reading reserves directly from pool account: ${this.poolAddress.slice(0, 12)}...`);

        const balances = await getBalances(this.poolAddress);

        this.reserveA = balances.find(b => b.token === this.tokenA)?.balance || 0n;
        this.reserveB = balances.find(b => b.token === this.tokenB)?.balance || 0n;

        console.log(`✅ Pool reserves: ${this.reserveA} tokenA + ${this.reserveB} tokenB`);

        return { reserveA: this.reserveA, reserveB: this.reserveB };
      } finally {
        // Clear the promise after completion so new updates can happen
        this._updatePromise = null;
      }
    })();

    return this._updatePromise;
  }

  /**
   * Execute a swap using SWAP REQUEST architecture (fully permissionless!)
   *
   * Step 1: User creates swap request (user publishes)
   * Step 2: Pool accepts swap request (OPS publishes, completing atomic swap)
   *
   * This is the CORRECT architecture for Keeta DEX swaps:
   * - User proposes: "I'll give X tokenIn, I want Y tokenOut"
   * - Pool accepts: "OK, I'll take your X tokenIn and give you Y tokenOut"
   * - Atomic swap completes in a single transaction
   * - No SEND_ON_BEHALF permissions needed
   * - Fully permissionless - any user can trade
   *
   * @param {Object} userClient - User's KeetaNet client (from createUserClient)
   * @param {string} userAddress - User's account address
   * @param {string} tokenIn - Input token address
   * @param {bigint} amountIn - Amount of input token (atomic)
   * @param {bigint} minAmountOut - Minimum acceptable output amount (slippage protection)
   * @returns {Promise<{ amountOut: bigint, feeAmount: bigint, priceImpact: number, requestHash: string, acceptHash: string }>}
   */
  async swap(userClient, userAddress, tokenIn, amountIn, minAmountOut = 0n) {
    await this.updateReserves();
    await this.loadLiquidityPositions();

    // Determine direction
    const isAtoB = tokenIn === this.tokenA;
    const reserveIn = isAtoB ? this.reserveA : this.reserveB;
    const reserveOut = isAtoB ? this.reserveB : this.reserveA;
    const tokenOut = isAtoB ? this.tokenB : this.tokenA;

    // Calculate output amount with fee
    const { amountOut, feeAmount, priceImpact } = calculateSwapOutput(
      amountIn,
      reserveIn,
      reserveOut,
      CONFIG.SWAP_FEE_BPS
    );

    // Check slippage
    if (amountOut < minAmountOut) {
      throw new Error(
        `Slippage too high: expected min ${minAmountOut}, got ${amountOut}`
      );
    }

    const treasury = getTreasuryAccount();

    const tokenInAccount = accountFromAddress(tokenIn);
    const tokenOutAccount = accountFromAddress(tokenOut);
    const userAccount = accountFromAddress(userAddress);
    const poolAccount = accountFromAddress(this.poolAddress);
    const treasuryAccount = treasury;

    // Calculate fee split (SushiSwap model)
    // Total fee: 0.3% (used for AMM calculation)
    // Split: 0.25% to LPs (stays in pool), 0.05% to protocol (treasury)
    const protocolFee = (amountIn * BigInt(CONFIG.PROTOCOL_FEE_BPS)) / 10000n;  // 0.05%
    const amountToPool = amountIn - protocolFee;                                 // 99.95%
    const lpFeeAmount = feeAmount - protocolFee;                                 // 0.25%

    console.log(`🔄 SWAP REQUEST: ${amountIn} ${tokenIn.slice(0, 12)}... → ${amountOut} ${tokenOut.slice(0, 12)}...`);
    console.log(`   User: ${userAddress.slice(0, 12)}...`);
    console.log(`   Total Fee: ${feeAmount} (0.3%)`);
    console.log(`   ├─ LP Fee: ${lpFeeAmount} (0.25% - stays in pool)`);
    console.log(`   └─ Protocol Fee: ${protocolFee} (0.05% - to treasury)`);

    // ============================================================================
    // SIMPLE TWO-TRANSACTION SWAP ARCHITECTURE (SushiSwap Model)
    // ============================================================================
    // TX1: User sends amountIn, split between pool and treasury
    //     - Pool gets 99.95% (includes 0.25% LP fee in reserves)
    //     - Treasury gets 0.05% (protocol fee)
    // TX2: Pool sends amountOut to user (using SEND_ON_BEHALF)
    //
    // AMM calculation uses 0.3% total fee for price impact.
    // LPs earn 0.25% (stays in pool reserves, increases LP token value).
    // Protocol earns 0.05% (sent to treasury for operations).
    // ============================================================================

    // TX1: User sends tokenIn, split between pool and treasury
    console.log('📝 TX1: User sends tokenIn (split: pool + treasury)...');
    const tx1Builder = userClient.initBuilder();

    // Send to pool (99.95% - includes LP fee in reserves)
    tx1Builder.send(poolAccount, amountToPool, tokenInAccount);

    // Send protocol fee to treasury (0.05%)
    if (protocolFee > 0n) {
      tx1Builder.send(treasuryAccount, protocolFee, tokenInAccount);
    }

    await userClient.publishBuilder(tx1Builder);

    // Extract TX1 block hash from builder.blocks array
    // This is the transaction where user sends tokens to pool (shown in explorer)
    // Transaction structure:
    // Block 0: User sends tokenIn to pool (99.95% - includes LP fee) <- THIS ONE for explorer
    // Block 1: User sends protocol fee to treasury (0.05%)
    let tx1Hash = null;
    if (tx1Builder.blocks && tx1Builder.blocks.length > 0) {
      // Use index 0 (first block) - the user sends tokenIn to pool
      const block = tx1Builder.blocks[0];
      console.log('📦 Block at index 0 (user->pool tokenIn):', {
        hasHash: !!block?.hash,
        hashType: block?.hash ? typeof block.hash : 'none',
        totalBlocks: tx1Builder.blocks.length
      });

      if (block && block.hash) {
        // Convert BlockHash to hex string
        if (typeof block.hash === 'string') {
          tx1Hash = block.hash.toUpperCase();
        } else if (block.hash.toString) {
          // Try toString first
          const hashStr = block.hash.toString();
          if (hashStr.match(/^[0-9A-Fa-f]+$/)) {
            tx1Hash = hashStr.toUpperCase();
          } else if (block.hash.toString('hex')) {
            // If toString doesn't give hex, try toString('hex')
            tx1Hash = block.hash.toString('hex').toUpperCase();
          }
        }
      }
    }

    console.log(`✅ TX1 published (hash: ${tx1Hash || 'NOT_CAPTURED'}):`);
    console.log(`   Pool received: ${amountToPool} (includes ${lpFeeAmount} LP fee)`);
    console.log(`   Treasury received: ${protocolFee} (protocol fee)`);

    // Wait briefly for TX1 to be processed
    await new Promise(resolve => setTimeout(resolve, 1000));

    // TX2: Pool sends tokenOut to user
    console.log('📝 TX2: Pool sends tokenOut to user...');
    const opsClient = await getOpsClient();
    const tx2Builder = opsClient.initBuilder();

    // Pool sends tokenOut to user
    // Use { account: poolAccount } because OPS has SEND_ON_BEHALF permission on pool
    tx2Builder.send(userAccount, amountOut, tokenOutAccount, undefined, {
      account: poolAccount,
    });

    const tx2Block = await opsClient.publishBuilder(tx2Builder);
    let tx2Hash = 'unknown';
    if (tx2Block) {
      if (tx2Block.hash) {
        tx2Hash = typeof tx2Block.hash === 'string'
          ? tx2Block.hash.toUpperCase()
          : tx2Block.hash.toString('hex').toUpperCase();
      } else if (tx2Block.blockHash) {
        tx2Hash = tx2Block.blockHash.toUpperCase();
      }
    }
    console.log(`✅ TX2 published (hash: ${tx2Hash}): Pool sent ${amountOut} tokenOut to user`);

    // Update reserves after swap
    await this.updateReserves();

    // Log swap in explorer-style format and save to transaction history
    await this.logSwapTransaction(userAddress, tokenIn, tokenOut, amountIn, amountOut, priceImpact);

    // Record snapshot for APY/volume tracking
    await this.recordSnapshot();

    return {
      amountOut,
      feeAmount,
      priceImpact,
      newReserveA: this.reserveA,
      newReserveB: this.reserveB,
      tx1Hash,
      tx2Hash,
      blockHash: tx1Hash, // Return TX1 hash for explorer link (shows user sending tokens)
    };
  }

  /**
   * Log swap transaction in explorer style and save to history
   * Example: "SWAP_FORWARD keet...msamy keet...5hwi 50.491275 USDC 125.5970 KTA"
   */
  async logSwapTransaction(userAddress, tokenIn, tokenOut, amountIn, amountOut, priceImpact) {
    const fromAddr = this.abbreviateAddress(userAddress);
    const toAddr = this.abbreviateAddress(this.poolAddress);

    // Get decimals for proper formatting
    const decimalsIn = tokenIn === this.tokenA ? this.decimalsA : this.decimalsB;
    const decimalsOut = tokenOut === this.tokenA ? this.decimalsA : this.decimalsB;

    // Format amounts with proper decimals (no trailing zeros)
    const amountInFormatted = (Number(amountIn) / (10 ** decimalsIn)).toString();
    const amountOutFormatted = (Number(amountOut) / (10 ** decimalsOut)).toString();

    const tokenInSymbol = await this.getTokenSymbol(tokenIn);
    const tokenOutSymbol = await this.getTokenSymbol(tokenOut);

    const logMessage = `SWAP_FORWARD ${fromAddr} ${toAddr} ${amountInFormatted} ${tokenInSymbol} ${amountOutFormatted} ${tokenOutSymbol}`;
    console.log(logMessage);

    // Save to transaction history file
    await this.saveTransactionHistory({
      type: 'SWAP_FORWARD',
      timestamp: Date.now(),
      user: userAddress,
      pool: this.poolAddress,
      tokenIn,
      tokenOut,
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      priceImpact: priceImpact.toString(),
    });
  }

  /**
   * Save transaction to history file
   */
  async saveTransactionHistory(transaction) {
    try {
      const fs = await import('fs/promises');
      const historyPath = '.transactions.json';

      let transactions = [];
      try {
        const data = await fs.readFile(historyPath, 'utf8');
        transactions = JSON.parse(data);
      } catch (err) {
        // File doesn't exist yet, start with empty array
      }

      // Add new transaction at the beginning
      transactions.unshift(transaction);

      // Keep only last 1000 transactions
      if (transactions.length > 1000) {
        transactions = transactions.slice(0, 1000);
      }

      await fs.writeFile(historyPath, JSON.stringify(transactions, null, 2));
    } catch (err) {
      console.error('Failed to save transaction history:', err.message);
    }
  }

  /**
   * Record pool snapshot for APY/volume tracking
   * Saves current reserves to database for historical comparison
   */
  async recordSnapshot() {
    if (!this.repository) {
      console.warn('⚠️ No repository available, skipping snapshot');
      return;
    }

    try {
      await this.repository.saveSnapshot(
        this.poolAddress,
        this.reserveA,
        this.reserveB
      );
      console.log(`📸 Snapshot recorded: ${this.poolAddress.slice(-8)} - reserveA: ${this.reserveA}, reserveB: ${this.reserveB}`);
    } catch (error) {
      // Non-critical - don't fail the operation if snapshot fails
      console.warn(`⚠️ Failed to record snapshot (non-critical):`, error.message);
    }
  }

  /**
   * Abbreviate address (keet...xxxx style)
   */
  abbreviateAddress(address) {
    if (!address || address.length < 15) return address;
    const withoutPrefix = address.replace('keeta_', '');
    const end = withoutPrefix.substring(withoutPrefix.length - 4);
    return `keet...${end}`;
  }

  /**
   * Get token symbol from address
   * Tries to use actual token symbol from metadata, falls back to known symbols
   */
  async getTokenSymbol(tokenAddress) {
    // Fetch from on-chain metadata
    try {
      const metadata = await fetchTokenMetadata(tokenAddress);

      // Return symbol from metadata (fetchTokenMetadata already has fallback logic)
      return metadata.symbol;
    } catch (err) {
      console.warn(`Error fetching token symbol for ${tokenAddress.slice(0, 12)}...:`, err.message);
      // Fallback to shortened address
      return tokenAddress.slice(6, 10).toUpperCase();
    }
  }

  /**
   * Add liquidity to the pool
   *
   * @param {Object} userClient - User's KeetaNet client (from createUserClient)
   * @param {string} userAddress - User's account address
   * @param {bigint} amountADesired - Desired amount of token A
   * @param {bigint} amountBDesired - Desired amount of token B
   * @param {bigint} amountAMin - Minimum amount of token A (slippage protection)
   * @param {bigint} amountBMin - Minimum amount of token B (slippage protection)
   * @returns {Promise<{ amountA: bigint, amountB: bigint, liquidity: bigint }>}
   */
  async addLiquidity(
    userClient,
    userAddress,
    amountADesired,
    amountBDesired,
    amountAMin = 0n,
    amountBMin = 0n
  ) {
    await this.updateReserves();
    await this.loadLiquidityPositions();

    // Get existing position or create new one (no LP storage account needed)
    let existingLP = this.lpAccounts.get(userAddress);

    if (!existingLP) {
      console.log(`💧 Creating new liquidity position for ${userAddress.slice(0, 20)}...`);
      existingLP = {
        lpStorageAddress: null, // Not used in pooled liquidity
        shares: 0n,
        // amountA/amountB removed - calculated from current reserves on-demand
      };
    } else {
      console.log(`📊 Adding to existing position for ${userAddress.slice(0, 20)}...`);
    }

    // Calculate optimal amounts
    const { amountA, amountB } = calculateOptimalLiquidityAmounts(
      amountADesired,
      amountBDesired,
      this.reserveA,
      this.reserveB
    );

    // Check minimum amounts
    if (amountA < amountAMin) {
      throw new Error(`Insufficient token A: got ${amountA}, need ${amountAMin}`);
    }
    if (amountB < amountBMin) {
      throw new Error(`Insufficient token B: got ${amountB}, need ${amountBMin}`);
    }

    // Calculate shares to mint
    const shares = calculateLPTokensToMint(
      amountA,
      amountB,
      this.reserveA,
      this.reserveB,
      this.totalShares
    );

    if (shares <= 0n) {
      throw new Error('Insufficient liquidity minted');
    }

    // Build transaction using user's client
    const builder = userClient.initBuilder();

    const poolAccount = accountFromAddress(this.poolAddress);
    const tokenAAccount = accountFromAddress(this.tokenA);
    const tokenBAccount = accountFromAddress(this.tokenB);

    // User sends both tokens to the POOL account (pooled liquidity)
    builder.send(poolAccount, amountA, tokenAAccount);
    builder.send(poolAccount, amountB, tokenBAccount);

    // Execute transaction
    await userClient.publishBuilder(builder);

    // MINT LP TOKENS TO USER (Fungible token approach - like Uniswap)
    if (this.lpTokenAddress) {
      console.log(`🪙 Minting ${shares} LP tokens to ${userAddress.slice(0, 20)}...`);
      await mintLPTokens(this.lpTokenAddress, userAddress, shares);
      console.log(`✅ LP tokens minted successfully`);
    } else {
      console.warn(`⚠️ Pool ${this.poolAddress.slice(-8)} has no LP token - using legacy storage account approach`);

      // LEGACY: Storage account approach (for pools created before LP token implementation)
      const newShares = existingLP.shares + shares;
      let lpStorageAddress = existingLP.lpStorageAddress;

      if (!lpStorageAddress) {
        console.log(`📝 Creating LP STORAGE account on-chain for ${userAddress.slice(0, 20)}...`);
        lpStorageAddress = await createLPStorageAccount(userAddress, this.poolAddress, this.tokenA, this.tokenB);
        console.log(`✅ LP STORAGE account created: ${lpStorageAddress}`);
      }

      await updateLPMetadata(lpStorageAddress, newShares, this.poolAddress, userAddress);

      this.lpAccounts.set(userAddress, {
        lpStorageAddress,
        shares: newShares,
      });
    }

    this.totalShares += shares;

    // Save to database for tracking (optional - LP token balance is source of truth)
    if (this.repository) {
      try {
        const currentShares = existingLP.shares + shares;
        await this.repository.saveLPPosition(this.poolAddress, userAddress, currentShares);
        console.log(`✅ Database updated: ${currentShares} shares for ${userAddress.slice(0, 20)}...`);
      } catch (dbError) {
        console.warn(`⚠️ Database update failed (non-critical):`, dbError.message);
        console.log(`✅ Blockchain operations succeeded, database sync skipped`);
      }
    }

    await this.updateReserves();

    console.log(`✅ Added liquidity: ${amountA} tokenA + ${amountB} tokenB → ${shares} shares`);
    console.log(`   Pool: ${this.poolAddress}`);

    // Record snapshot for APY/volume tracking
    await this.recordSnapshot();

    return {
      amountA,
      amountB,
      liquidity: shares,
      poolAddress: this.poolAddress, // Return pool address instead of LP storage
      newReserveA: this.reserveA,
      newReserveB: this.reserveB,
    };
  }

  /**
   * Remove liquidity from the pool
   *
   * @param {Object} userClient - User's KeetaNet client (from createUserClient)
   * @param {string} userAddress - User's account address
   * @param {bigint} liquidity - Amount of shares to burn
   * @param {bigint} amountAMin - Minimum amount of token A to receive
   * @param {bigint} amountBMin - Minimum amount of token B to receive
   * @returns {Promise<{ amountA: bigint, amountB: bigint }>}
   */
  async removeLiquidity(userClient, userAddress, liquidity, amountAMin = 0n, amountBMin = 0n) {
    await this.updateReserves();

    // Get user's LP token balance (LP tokens are source of truth)
    let userShares = 0n;
    let totalShares = 0n;

    // If LP token address is not set, try to discover it on-chain by scanning user's wallet
    if (!this.lpTokenAddress) {
      console.log(`🔍 LP token address not set, discovering on-chain from user wallet...`);
      const client = await getOpsClient();
      const userAccount = accountFromAddress(userAddress);

      try {
        // Query all user's token balances
        const userBalances = await client.allBalances({ account: userAccount });

        // Check each token's metadata to find LP token for this pool
        for (const balance of userBalances) {
          const tokenAddr = balance.token.publicKeyString?.toString() ?? balance.token.toString();

          // Get token account info to check metadata
          const accountsInfo = await client.client.getAccountsInfo([tokenAddr]);
          const accountInfo = accountsInfo[tokenAddr];

          if (accountInfo?.info?.metadata) {
            try {
              // Decode metadata
              const metadataStr = Buffer.from(accountInfo.info.metadata, 'base64').toString('utf8');
              const metadata = JSON.parse(metadataStr);

              // Check if this is an LP token for our pool
              if (metadata.type === 'LP_TOKEN' && metadata.pool === this.poolAddress) {
                this.lpTokenAddress = tokenAddr;
                console.log(`✅ Discovered LP token on-chain: ${tokenAddr.slice(0, 30)}...`);
                break;
              }
            } catch (err) {
              // Not valid JSON metadata, skip
              continue;
            }
          }
        }

        if (!this.lpTokenAddress) {
          console.log(`⚠️ No LP token found in user wallet for this pool`);
        }
      } catch (err) {
        console.warn(`⚠️ Could not discover LP token on-chain:`, err.message);
      }
    }

    if (this.lpTokenAddress) {
      // NEW: Get balance from LP token (fungible token)
      userShares = await getLPTokenBalance(this.lpTokenAddress, userAddress);

      // Get total supply from LP token account info
      const client = await getOpsClient();
      const lpTokenAccount = accountFromAddress(this.lpTokenAddress);

      // Query LP token account to get total supply
      const lpTokenAccountInfo = await client.client.getAccountsInfo([this.lpTokenAddress]);
      const lpTokenInfo = lpTokenAccountInfo[this.lpTokenAddress];

      if (lpTokenInfo?.info?.supply) {
        totalShares = BigInt(lpTokenInfo.info.supply);
      } else {
        // Fallback to pool state totalShares
        totalShares = this.totalShares;
      }

      console.log(`🪙 LP token balance: user=${userShares}, total=${totalShares}`);
    } else if (this.repository) {
      // LEGACY: Load from PostgreSQL database (optional - don't fail if DB unavailable)
      try {
        const allPoolPositions = await this.repository.getLPPositions(this.poolAddress);
        const userPosition = allPoolPositions.find(pos => pos.user_address === userAddress);

        if (userPosition) {
          userShares = BigInt(userPosition.shares);
        }

        // Calculate total shares from all LP positions
        totalShares = allPoolPositions.reduce(
          (sum, pos) => sum + BigInt(pos.shares),
          0n
        );

        console.log(`📊 LP shares from database: user=${userShares}, total=${totalShares}`);
      } catch (dbError) {
        console.warn(`⚠️ Database query failed (non-critical):`, dbError.message);
        console.log(`⚠️ Cannot load legacy LP positions from database - user must have LP tokens or use file storage`);

        // Fall back to file storage
        await this.loadLiquidityPositions();
        const position = this.lpAccounts.get(userAddress);
        userShares = position?.shares || 0n;
        totalShares = this.totalShares;
        console.log(`📁 LP shares from file fallback: user=${userShares}, total=${totalShares}`);
      }
    } else {
      // LEGACY: Fallback to local file system
      await this.loadLiquidityPositions();
      const position = this.lpAccounts.get(userAddress);
      userShares = position?.shares || 0n;
      totalShares = this.totalShares;

      console.log(`📁 LP shares from file: user=${userShares}, total=${totalShares}`);
    }

    // Check if user has enough shares
    if (userShares < liquidity) {
      throw new Error(`Insufficient shares: have ${userShares}, need ${liquidity}`);
    }

    // Calculate amounts to return
    const { amountA, amountB } = calculateAmountsForLPBurn(
      liquidity,
      totalShares,
      this.reserveA,
      this.reserveB
    );

    console.log(`🔍 Removing liquidity calculation:`);
    console.log(`   Burning ${liquidity} shares out of ${totalShares} total`);
    console.log(`   Pool reserves: ${this.reserveA} tokenA, ${this.reserveB} tokenB`);
    console.log(`   Calculated return: ${amountA} tokenA, ${amountB} tokenB`);
    console.log(`   Share percentage: ${(Number(liquidity) * 100 / Number(totalShares)).toFixed(4)}%`);

    // Check minimum amounts
    if (amountA < amountAMin) {
      throw new Error(`Insufficient token A: got ${amountA}, need ${amountAMin}`);
    }
    if (amountB < amountBMin) {
      throw new Error(`Insufficient token B: got ${amountB}, need ${amountBMin}`);
    }

    // Build transaction with ops client (using SEND_ON_BEHALF)
    const client = await getOpsClient();
    const builder = client.initBuilder();

    const poolAccount = accountFromAddress(this.poolAddress);
    const tokenAAccount = accountFromAddress(this.tokenA);
    const tokenBAccount = accountFromAddress(this.tokenB);
    const userAccount = accountFromAddress(userAddress);

    // Ops uses SEND_ON_BEHALF to send tokens from pool account to user
    builder.send(userAccount, amountA, tokenAAccount, undefined, {
      account: poolAccount,
    });
    builder.send(userAccount, amountB, tokenBAccount, undefined, {
      account: poolAccount,
    });

    // Execute transaction
    await client.publishBuilder(builder);

    // BURN LP TOKENS FROM USER (Fungible token approach - like Uniswap)
    if (this.lpTokenAddress) {
      console.log(`🔥 Burning ${liquidity} LP tokens from ${userAddress.slice(0, 20)}...`);
      await burnLPTokens(this.lpTokenAddress, userClient, userAddress, liquidity);
      console.log(`✅ LP tokens burned successfully`);
    } else {
      console.warn(`⚠️ Pool ${this.poolAddress.slice(-8)} has no LP token - using legacy storage account approach`);

      // LEGACY: Update position tracking in database/files
      const newShares = userShares - liquidity;

      if (this.repository) {
        // Update PostgreSQL database (optional - don't fail if DB is unavailable)
        try {
          await this.repository.saveLPPosition(this.poolAddress, userAddress, newShares);
          console.log(`✅ Database updated: ${newShares} shares remaining for ${userAddress.slice(0, 20)}...`);
        } catch (dbError) {
          console.warn(`⚠️ Database update failed (non-critical):`, dbError.message);
          console.log(`✅ Blockchain operations succeeded, database sync skipped`);
        }
      } else {
        // Legacy file-based storage
        const position = this.lpAccounts.get(userAddress);
        if (position) {
          position.shares -= liquidity;

          if (position.shares === 0n) {
            this.lpAccounts.delete(userAddress);
            console.log(`✅ User position fully removed`);
          } else {
            this.lpAccounts.set(userAddress, position);
            console.log(`✅ User still has ${position.shares} shares remaining`);
          }
        }

        await this.saveLiquidityPositions();
      }
    }

    this.totalShares -= liquidity;
    await this.updateReserves();

    console.log(`✅ Removed liquidity: ${liquidity} shares → ${amountA} tokenA + ${amountB} tokenB`);
    console.log(`   From pool: ${this.poolAddress}`);

    // Record snapshot for APY/volume tracking
    await this.recordSnapshot();

    return {
      amountA,
      amountB,
      newReserveA: this.reserveA,
      newReserveB: this.reserveB,
    };
  }

  /**
   * Get current pool state
   */
  async getPoolInfo() {
    await this.updateReserves();
    await this.loadLiquidityPositions();

    const price = calculatePrice(
      this.reserveA,
      this.reserveB,
      this.decimalsA,
      this.decimalsB
    );

    // Fetch token symbols
    const symbolA = await this.getTokenSymbol(this.tokenA);
    const symbolB = await this.getTokenSymbol(this.tokenB);

    return {
      poolAddress: this.poolAddress,
      tokenA: this.tokenA,
      tokenB: this.tokenB,
      symbolA,
      symbolB,
      reserveA: this.reserveA.toString(),
      reserveB: this.reserveB.toString(),
      reserveAHuman: fromAtomic(this.reserveA, this.decimalsA),
      reserveBHuman: fromAtomic(this.reserveB, this.decimalsB),
      totalLPSupply: this.totalShares.toString(),  // Use totalShares (backwards compatible field name)
      lpTokenAddress: this.lpTokenAddress || null,  // Include LP token address
      priceAtoB: price.priceAtoB,
      priceBtoA: price.priceBtoA,
      decimalsA: this.decimalsA,
      decimalsB: this.decimalsB,
    };
  }

  /**
   * Get quote for a swap (without executing)
   */
  async getSwapQuote(tokenIn, amountIn) {
    await this.updateReserves();

    const isAtoB = tokenIn === this.tokenA;
    const reserveIn = isAtoB ? this.reserveA : this.reserveB;
    const reserveOut = isAtoB ? this.reserveB : this.reserveA;
    const decimalsIn = isAtoB ? this.decimalsA : this.decimalsB;
    const decimalsOut = isAtoB ? this.decimalsB : this.decimalsA;

    const { amountOut, feeAmount, priceImpact } = calculateSwapOutput(
      amountIn,
      reserveIn,
      reserveOut,
      CONFIG.SWAP_FEE_BPS
    );

    // Calculate with 0.5% slippage
    const minAmountOut = calculateMinAmountOut(amountOut, 0.5);

    return {
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      amountInHuman: fromAtomic(amountIn, decimalsIn),
      amountOutHuman: fromAtomic(amountOut, decimalsOut),
      feeAmount: feeAmount.toString(),
      feeAmountHuman: fromAtomic(feeAmount, decimalsIn),
      priceImpact: priceImpact.toFixed(4),
      minAmountOut: minAmountOut.toString(),
      minAmountOutHuman: fromAtomic(minAmountOut, decimalsOut),
    };
  }

  /**
   * Get user's LP position
   */
  async getUserLPBalance(userAddress) {
    await this.updateReserves();
    await this.loadLiquidityPositions();

    const position = this.lpAccounts.get(userAddress);
    if (!position || this.totalShares === 0n) {
      return {
        lpBalance: '0',
        sharePercent: 0,
        amountA: '0',
        amountB: '0',
      };
    }

    const { amountA, amountB } = calculateAmountsForLPBurn(
      position.shares,
      this.totalShares,
      this.reserveA,
      this.reserveB
    );

    const sharePercent = (Number(position.shares) / Number(this.totalShares)) * 100;

    return {
      lpBalance: position.shares.toString(),
      lpStorageAddress: position.lpStorageAddress, // Add LP storage address
      sharePercent: sharePercent.toFixed(4),
      amountA: amountA.toString(),
      amountB: amountB.toString(),
      amountAHuman: fromAtomic(amountA, this.decimalsA),
      amountBHuman: fromAtomic(amountB, this.decimalsB),
    };
  }
}

export default Pool;
