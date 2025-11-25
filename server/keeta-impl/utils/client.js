// src/utils/client.js
import * as KeetaNet from '@keetanetwork/keetanet-client';
import { CONFIG, seedFromHexEnv, cacheDecimals, getCachedDecimals } from './constants.js';

let opsClient = null;
let treasuryAccount = null;
let opsAccount = null;

/**
 * Reset the ops client (clears cached votes)
 */
export function resetOpsClient() {
  opsClient = null;
  opsAccount = null;
  console.log('🔄 Ops client reset');
}

/**
 * Initialize and return a singleton UserClient for operations
 */
export async function getOpsClient() {
  if (!opsClient) {
    const opsSeed = seedFromHexEnv('OPS_SEED');
    opsAccount = KeetaNet.lib.Account.fromSeed(opsSeed, 0);
    opsClient = KeetaNet.UserClient.fromNetwork(CONFIG.NETWORK, opsAccount);
    console.log('✅ Ops client initialized:', opsAccount.publicKeyString.get());
  }
  return opsClient;
}

/**
 * Validate a hex seed string
 * @param {string} seedHex - Seed to validate
 * @returns {boolean}
 */
function validateHexSeed(seedHex) {
  if (!seedHex || typeof seedHex !== 'string') return false;
  const trimmed = seedHex.trim();
  return /^[0-9A-Fa-f]{64}$/.test(trimmed);
}

/**
 * Create a UserClient from a user's seed (for permissionless operations)
 * @param {string} seedHex - User's seed as hex string
 * @param {number} accountIndex - Account index (default 0)
 * @returns {Object} { client: UserClient, account: Account, address: string }
 */
export function createUserClient(seedHex, accountIndex = 0) {
  if (!validateHexSeed(seedHex)) {
    throw new Error('Invalid seed: must be 64 hex characters');
  }

  const seed = Buffer.from(seedHex.trim(), 'hex');
  const account = KeetaNet.lib.Account.fromSeed(seed, accountIndex);
  const client = KeetaNet.UserClient.fromNetwork(CONFIG.NETWORK, account);
  const address = account.publicKeyString.get();

  console.log(`✅ User client created: ${address}`);

  return { client, account, address };
}

/**
 * Get the treasury account (for fee collection)
 * Hardcoded treasury address to avoid seed derivation index mismatch
 */
export function getTreasuryAccount() {
  if (!treasuryAccount) {
    // Hardcoded treasury address (avoids index derivation issues)
    const TREASURY_ADDRESS = 'keeta_aabtozgfunwwvwdztv54y6l5x57q2g3254shgp27zjltr2xz3pyo7q4tjtmsamy';
    treasuryAccount = accountFromAddress(TREASURY_ADDRESS);
    console.log('✅ Treasury account loaded:', treasuryAccount.publicKeyString.get());
  }
  return treasuryAccount;
}

/**
 * Get the ops account
 */
export function getOpsAccount() {
  if (!opsAccount) {
    const opsSeed = seedFromHexEnv('OPS_SEED');
    opsAccount = KeetaNet.lib.Account.fromSeed(opsSeed, 0);
  }
  return opsAccount;
}

/**
 * Fetch token metadata from on-chain (symbol/ticker and decimals)
 * @param {string} tokenAddress - Token address
 * @returns {Promise<{symbol: string, decimals: number}>}
 */
export async function fetchTokenMetadata(tokenAddress) {
  // Check decimals cache first
  const cachedDecimals = getCachedDecimals(tokenAddress);

  try {
    const client = await getOpsClient();

    // Use getAccountsInfo (plural) which takes an array of accounts
    const accountsInfo = await client.client.getAccountsInfo([tokenAddress]);
    const info = accountsInfo[tokenAddress];

    if (info?.info) {
      // Get symbol from info.name (this is where Keeta stores the token symbol)
      const symbol = info.info.name || tokenAddress.slice(0, 8) + '...';

      // Get decimals from metadata object
      let decimals = 9; // Default
      if (info.info.metadata) {
        try {
          const metaObj = JSON.parse(
            Buffer.from(info.info.metadata, 'base64').toString()
          );
          decimals = Number(metaObj.decimalPlaces || metaObj.decimals || 9);
        } catch (parseErr) {
          console.warn(`⚠️ Could not parse metadata for ${tokenAddress.slice(0, 12)}...`);
        }
      }

      // Cache decimals
      cacheDecimals(tokenAddress, decimals);

      console.log(`✅ Fetched metadata for ${symbol}: ${decimals} decimals`);
      return { symbol, decimals };
    }
  } catch (err) {
    // Log error for debugging
    console.warn(`⚠️ Could not fetch metadata for ${tokenAddress.slice(0, 12)}...: ${err.message}`);
    // Silently use cached/default values - this is expected for some tokens
    if (cachedDecimals === undefined) {
      console.log(`ℹ️ Using default metadata for ${tokenAddress.slice(0, 12)}...`);
    }
  }

  // Default values if metadata not found
  const decimals = cachedDecimals !== undefined ? cachedDecimals : 9;
  const symbol = tokenAddress.slice(0, 8) + '...';

  if (cachedDecimals === undefined) {
    cacheDecimals(tokenAddress, decimals);
  }

  return { symbol, decimals };
}

/**
 * Fetch token decimals from on-chain metadata
 */
export async function fetchTokenDecimals(tokenAddress) {
  const metadata = await fetchTokenMetadata(tokenAddress);
  return metadata.decimals;
}

/**
 * Get all balances for an account
 */
export async function getBalances(accountOrAddress) {
  const client = await getOpsClient();
  
  let account;
  if (typeof accountOrAddress === 'string') {
    account = KeetaNet.lib.Account.fromPublicKeyString(accountOrAddress);
  } else {
    account = accountOrAddress;
  }
  
  const rawBalances = await client.allBalances({ account });
  
  return rawBalances.map((b) => ({
    token: b.token.publicKeyString?.toString() ?? b.token.toString(),
    balance: BigInt(b.balance ?? 0n),
  }));
}

/**
 * Get specific token balance for an account
 */
export async function getTokenBalance(accountAddress, tokenAddress) {
  const balances = await getBalances(accountAddress);
  const balance = balances.find((b) => b.token === tokenAddress);
  return balance?.balance ?? 0n;
}

/**
 * Create a new storage account for a pool
 */
/**
 * Create an LP storage account with dual ownership
 * User owns the account (can withdraw directly)
 * Ops has SEND_ON_BEHALF (can route swaps)
 *
 * @param {string} userAddress - User's address who will own this LP account
 * @param {string} poolIdentifier - Pool address
 * @param {string} tokenA - Token A address
 * @param {string} tokenB - Token B address
 * @returns {Promise<string>} LP storage account address
 */
export async function createLPStorageAccount(userAddress, poolIdentifier, tokenA, tokenB) {
  const client = await getOpsClient();
  const ops = getOpsAccount();

  const builder = client.initBuilder();

  // Generate new storage account for this LP position
  const pending = builder.generateIdentifier(
    KeetaNet.lib.Account.AccountKeyAlgorithm.STORAGE
  );
  await builder.computeBlocks();

  const storageAccount = pending.account;
  const storageAddress = storageAccount.publicKeyString.toString();

  // Fetch token symbols for human-readable description
  let symbolA = 'TOKENA';
  let symbolB = 'TOKENB';
  try {
    const metadataA = await fetchTokenMetadata(tokenA);
    const metadataB = await fetchTokenMetadata(tokenB);
    symbolA = metadataA.symbol;
    symbolB = metadataB.symbol;
  } catch (err) {
    console.warn(`⚠️ Could not fetch token symbols, using defaults`);
  }

  // Metadata must be base64 encoded
  const metadataObj = {
    pool: poolIdentifier,
    owner: userAddress,
    createdAt: Date.now()
  };
  const metadataBase64 = Buffer.from(JSON.stringify(metadataObj)).toString('base64');

  builder.setInfo(
    {
      name: `SB_LP`,
      description: `Liquidity pool for ${symbolA}/${symbolB}`,
      metadata: metadataBase64,
      defaultPermission: new KeetaNet.lib.Permissions([
        'ACCESS',
        'STORAGE_CAN_HOLD',
      ]),
    },
    { account: storageAccount }
  );

  const userAccount = accountFromAddress(userAddress);
  const opsAddress = ops.publicKeyString.get();

  // Check if user and ops are the same account
  if (userAddress === opsAddress) {
    // Same account: grant all permissions once
    builder.updatePermissions(
      ops,
      new KeetaNet.lib.Permissions([
        'OWNER',
        'STORAGE_DEPOSIT',
        'SEND_ON_BEHALF',
      ]),
      undefined,
      undefined,
      { account: storageAccount }
    );
  } else {
    // Different accounts: grant permissions separately
    // Grant OWNER to user (they control their funds)
    builder.updatePermissions(
      userAccount,
      new KeetaNet.lib.Permissions([
        'OWNER',
        'STORAGE_DEPOSIT',
        'SEND_ON_BEHALF', // User can withdraw their own funds
      ]),
      undefined,
      undefined,
      { account: storageAccount }
    );

    // Grant SEND_ON_BEHALF and UPDATE_INFO to ops (for routing swaps and updating metadata)
    builder.updatePermissions(
      ops,
      new KeetaNet.lib.Permissions([
        'SEND_ON_BEHALF',
        'STORAGE_DEPOSIT',
        'UPDATE_INFO', // Allow ops to update metadata with shares
      ]),
      undefined,
      undefined,
      { account: storageAccount }
    );
  }

  // Publish the transaction
  await client.publishBuilder(builder);

  console.log(`✅ LP storage account created: ${storageAddress}`);
  console.log(`   Owner: ${userAddress}`);
  console.log(`   Router: ${ops.publicKeyString.get()}`);

  return storageAddress;
}

export async function createStorageAccount(name, description, isPool = false, creatorAddress = null) {
  const client = await getOpsClient();
  const ops = getOpsAccount();
  const treasury = getTreasuryAccount();

  const builder = client.initBuilder();

  // Generate new storage account
  const pending = builder.generateIdentifier(
    KeetaNet.lib.Account.AccountKeyAlgorithm.STORAGE
  );
  await builder.computeBlocks();

  const storageAccount = pending.account;
  const marketId = storageAccount.publicKeyString.toString();

  // Check if ops and treasury are the same account
  const opsAddress = ops.publicKeyString.get();
  const treasuryAddress = treasury.publicKeyString.get();
  const sameAccount = opsAddress === treasuryAddress;

  // Default permissions for storage accounts (base flags only)
  const basePermissions = [
    'ACCESS',
    'STORAGE_CAN_HOLD',
    'STORAGE_DEPOSIT',
  ];

  // Set account info
  builder.setInfo(
    {
      name,
      description,
      metadata: '',
      defaultPermission: new KeetaNet.lib.Permissions(basePermissions),
    },
    { account: storageAccount }
  );

  // If creator is provided and different from ops: creator owns pool, ops routes
  if (creatorAddress && creatorAddress !== opsAddress) {
    const creatorAccount = accountFromAddress(creatorAddress);

    // Grant OWNER to creator (they control the pool)
    builder.updatePermissions(
      creatorAccount,
      new KeetaNet.lib.Permissions([
        'OWNER',
        'STORAGE_DEPOSIT',
      ]),
      undefined,
      undefined,
      { account: storageAccount }
    );

    // Grant SEND_ON_BEHALF to ops (for routing swaps only, NOT owner)
    builder.updatePermissions(
      ops,
      new KeetaNet.lib.Permissions([
        'SEND_ON_BEHALF',
        'STORAGE_DEPOSIT',
        'ACCESS',
      ]),
      undefined,
      undefined,
      { account: storageAccount }
    );
  } else {
    // No creator specified or creator is ops: ops owns the storage account
    builder.updatePermissions(
      ops,
      new KeetaNet.lib.Permissions([
        'OWNER',
        'SEND_ON_BEHALF',
        'STORAGE_DEPOSIT',
      ]),
      undefined,
      undefined,
      { account: storageAccount }
    );
  }

  await client.publishBuilder(builder);

  return marketId;
}

// ============================================
// LP TOKEN FUNCTIONS (Fungible Tokens)
// ============================================
// These functions create/manage REAL fungible LP tokens (not storage metadata)
// LP tokens represent pool shares and are tradeable/composable

/**
 * Create a fungible LP token for a liquidity pool
 * This creates an actual Keeta token (like ERC-20) that represents pool shares
 *
 * @param {string} poolAddress - Pool storage account address
 * @param {string} tokenA - Token A address
 * @param {string} tokenB - Token B address
 * @returns {Promise<string>} LP token address
 */
export async function createLPToken(poolAddress, tokenA, tokenB) {
  const client = await getOpsClient();
  const ops = getOpsAccount();

  console.log(`📝 Creating LP token for pool ${poolAddress.slice(-8)}...`);

  // Fetch token symbols for human-readable LP token name
  let symbolA = 'TKA';
  let symbolB = 'TKB';
  try {
    const [metadataA, metadataB] = await Promise.all([
      fetchTokenMetadata(tokenA),
      fetchTokenMetadata(tokenB)
    ]);
    symbolA = metadataA.symbol || 'TKA';
    symbolB = metadataB.symbol || 'TKB';
  } catch (err) {
    console.warn(`⚠️ Could not fetch token symbols, using defaults`);
  }

  const builder = client.initBuilder();

  // Generate new token account for LP token
  const pending = builder.generateIdentifier(
    KeetaNet.lib.Account.AccountKeyAlgorithm.TOKEN
  );
  await builder.computeBlocks();

  const lpTokenAccount = pending.account;
  const lpTokenAddress = lpTokenAccount.publicKeyString.toString();

  // Set token info (ERC-20 style fungible token)
  // Note: Keeta token names must be uppercase letters and underscores only
  // Metadata must be base64 encoded
  const metadataObj = {
    type: 'LP_TOKEN',
    pool: poolAddress,
    tokenA,
    tokenB,
    createdAt: Date.now()
  };
  const metadataBase64 = Buffer.from(JSON.stringify(metadataObj)).toString('base64');

  builder.setInfo(
    {
      name: `${symbolA}_${symbolB}_LP`,
      description: 'Silverback Liquidity Token',
      decimals: 9,
      metadata: metadataBase64,
      defaultPermission: new KeetaNet.lib.Permissions([
        'ACCESS',
      ]),
    },
    { account: lpTokenAccount }
  );

  // Grant OPS OWNER permission to manage LP token supply
  builder.updatePermissions(
    ops,
    new KeetaNet.lib.Permissions([
      'OWNER',
      'SEND_ON_BEHALF',  // Allow OPS to send LP tokens on behalf of LP token account
    ]),
    undefined,
    undefined,
    { account: lpTokenAccount }
  );

  // Publish the transaction
  try {
    await client.publishBuilder(builder);
  } catch (error) {
    console.error(`❌ Failed to publish LP token creation transaction:`, error.message);
    throw new Error(`LP token creation failed: ${error.message}`);
  }

  // Wait for blockchain finalization (10 seconds to be safe)
  console.log(`⏳ Waiting for blockchain finalization (10s)...`);
  await new Promise(resolve => setTimeout(resolve, 10000));

  // Verify the LP token was actually created on-chain
  console.log(`🔍 Verifying LP token was created...`);
  console.log(`   Checking address: ${lpTokenAddress}`);
  try {
    const accountsInfo = await client.client.getAccountsInfo([lpTokenAddress]);

    // getAccountsInfo returns an object with addresses as keys, not an array!
    const accountInfo = accountsInfo && accountsInfo[lpTokenAddress] ? accountsInfo[lpTokenAddress] : null;

    if (!accountInfo || !accountInfo.info) {
      throw new Error(`LP token account was not created on-chain`);
    }

    if (!accountInfo.info.metadata) {
      throw new Error(`LP token exists but has no metadata`);
    }

    console.log(`✅ LP token created and verified: ${lpTokenAddress}`);
    console.log(`   Symbol: ${symbolA}-${symbolB}-LP`);
    console.log(`   Pool: ${poolAddress.slice(-8)}`);
  } catch (error) {
    console.error(`❌ LP token verification failed:`, error.message);
    throw new Error(`LP token verification failed: ${error.message}. The pool cannot be used without a valid LP token.`);
  }

  return lpTokenAddress;
}

/**
 * Mint LP tokens to a user when they add liquidity
 *
 * @param {string} lpTokenAddress - LP token address
 * @param {string} recipientAddress - User address to receive LP tokens
 * @param {bigint} amount - Amount of LP tokens to mint
 */
export async function mintLPTokens(lpTokenAddress, recipientAddress, amount) {
  const client = await getOpsClient();

  console.log(`🪙 Minting ${amount} LP tokens to ${recipientAddress.slice(0, 20)}...`);
  console.log(`   LP Token Address: ${lpTokenAddress}`);
  console.log(`   Recipient Address: ${recipientAddress}`);
  console.log(`   Amount: ${amount}`);

  const lpTokenAccount = accountFromAddress(lpTokenAddress);
  const recipientAccount = accountFromAddress(recipientAddress);

  // Step 1: Mint tokens (they go to LP token account's own balance)
  console.log(`   [TX1/2] Calling modifyTokenSupply to mint ${amount} tokens...`);
  const builder1 = client.initBuilder();
  builder1.modifyTokenSupply(amount, { account: lpTokenAccount });

  try {
    await client.publishBuilder(builder1);
    console.log(`   ✅ [TX1/2] modifyTokenSupply succeeded`);
  } catch (error) {
    console.error(`   ❌ [TX1/2] modifyTokenSupply FAILED:`, error.message);
    throw new Error(`Failed to mint LP tokens (modifyTokenSupply): ${error.message}`);
  }

  console.log(`🔄 Tokens minted in LP token account, transferring to recipient...`);

  // Wait for finalization before sending
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Step 2: Send FROM LP token account TO recipient
  // Using { account: lpTokenAccount } to specify sending FROM the token account
  console.log(`   [TX2/2] Sending ${amount} LP tokens from LP token account to recipient...`);
  const builder2 = client.initBuilder();
  builder2.send(
    recipientAccount,              // TO: recipient wallet
    amount,                        // amount to send
    lpTokenAccount,                // which token
    undefined,                     // no external ref
    { account: lpTokenAccount }    // FROM: LP token account
  );

  try {
    await client.publishBuilder(builder2);
    console.log(`   ✅ [TX2/2] send succeeded`);
  } catch (error) {
    console.error(`   ❌ [TX2/2] send FAILED:`, error.message);
    throw new Error(`Failed to send minted LP tokens to recipient: ${error.message}`);
  }

  console.log(`✅ Minted ${amount} LP tokens to ${recipientAddress.slice(0, 20)}...`);
}

/**
 * Burn LP tokens from a user when they remove liquidity
 * Two-transaction flow: User sends LP tokens, then OPS burns supply
 *
 * @param {string} lpTokenAddress - LP token address
 * @param {Object} userClient - User's client to send LP tokens
 * @param {string} userAddress - User address whose LP tokens to burn
 * @param {bigint} amount - Amount of LP tokens to burn
 */
export async function burnLPTokens(lpTokenAddress, userClient, userAddress, amount) {
  const opsClient = await getOpsClient();
  const ops = getOpsAccount();
  const opsAddress = ops.publicKeyString.get();

  console.log(`🔥 Burning ${amount} LP tokens from ${userAddress.slice(0, 20)}...`);

  const lpTokenAccount = accountFromAddress(lpTokenAddress);
  const userAccount = accountFromAddress(userAddress);

  // TX1: User sends LP tokens to LP token account
  // This is necessary because modifyTokenSupply burns from the LP token account's balance
  console.log(`  📤 TX1: User sending ${amount} LP tokens to LP token account...`);
  const tx1Builder = userClient.initBuilder();
  tx1Builder.send(lpTokenAccount, amount, lpTokenAccount);
  await userClient.publishBuilder(tx1Builder);
  console.log(`  ✅ TX1 complete: LP tokens sent to LP token account`);

  // Wait for TX1 to settle
  await new Promise(resolve => setTimeout(resolve, 2000));

  // TX2: OPS burns the LP token supply
  console.log(`  🔥 TX2: OPS decreasing LP token supply by ${amount}...`);
  const tx2Builder = opsClient.initBuilder();
  tx2Builder.modifyTokenSupply(-amount, { account: lpTokenAccount });
  await opsClient.publishBuilder(tx2Builder);
  console.log(`  ✅ TX2 complete: LP token supply decreased`);

  console.log(`✅ Burned ${amount} LP tokens from ${userAddress.slice(0, 20)}...`);
}

/**
 * Get LP token balance for a user
 *
 * @param {string} lpTokenAddress - LP token address
 * @param {string} userAddress - User address
 * @returns {Promise<bigint>} LP token balance
 */
export async function getLPTokenBalance(lpTokenAddress, userAddress) {
  const balances = await getBalances(userAddress);

  for (const balance of balances) {
    if (balance.token === lpTokenAddress) {
      return BigInt(balance.balance);
    }
  }

  return 0n;
}

/**
 * Helper to create Account objects from addresses
 */
export function accountFromAddress(address) {
  return KeetaNet.lib.Account.fromPublicKeyString(address);
}

/**
 * Update LP position metadata in STORAGE account
 * Stores shares on-chain for transparent, verifiable LP tracking
 *
 * @param {string} lpStorageAddress - LP STORAGE account address
 * @param {bigint} shares - LP shares amount
 * @param {string} poolAddress - Pool address
 * @param {string} userAddress - User's address (owner)
 */
export async function updateLPMetadata(lpStorageAddress, shares, poolAddress, userAddress) {
  const client = await getOpsClient();
  const ops = getOpsAccount();
  const builder = client.initBuilder();

  const lpAccount = accountFromAddress(lpStorageAddress);

  // Create metadata object with shares and pool info
  const metadataObj = {
    pool: poolAddress,
    owner: userAddress,
    shares: shares.toString(), // Store as string to preserve precision
    updatedAt: Date.now()
  };
  const metadataBase64 = Buffer.from(JSON.stringify(metadataObj)).toString('base64');

  // First get existing account info to preserve name and description
  const accountsInfo = await client.client.getAccountsInfo([lpStorageAddress]);
  const existingInfo = accountsInfo[lpStorageAddress]?.info;

  // Update storage account info with new metadata (preserve existing name/description)
  // For identifier accounts, ALL fields are required: name, description, metadata, defaultPermission
  builder.setInfo(
    {
      name: existingInfo?.name || 'SB_LP',
      description: existingInfo?.description || 'Silverback LP',
      metadata: metadataBase64,
      defaultPermission: new KeetaNet.lib.Permissions([
        'ACCESS',
        'STORAGE_CAN_HOLD',
      ]),
    },
    { account: lpAccount }
  );

  await client.publishBuilder(builder);

  console.log(`✅ Updated LP metadata on-chain: ${shares} shares`);
}

/**
 * Read LP position metadata from STORAGE account
 *
 * @param {string} lpStorageAddress - LP STORAGE account address
 * @returns {Promise<{ shares: bigint, pool: string, owner: string } | null>}
 */
export async function readLPMetadata(lpStorageAddress) {
  try {
    const client = await getOpsClient();

    // Use getAccountsInfo (plural) which takes an array
    const accountsInfo = await client.client.getAccountsInfo([lpStorageAddress]);
    const info = accountsInfo[lpStorageAddress];

    if (!info?.info?.metadata) {
      return null;
    }

    // Decode base64 metadata
    const metadataJson = Buffer.from(info.info.metadata, 'base64').toString('utf8');
    const metadata = JSON.parse(metadataJson);

    return {
      shares: BigInt(metadata.shares),
      pool: metadata.pool,
      owner: metadata.owner,
      updatedAt: metadata.updatedAt
    };
  } catch (err) {
    console.warn(`⚠️ Could not read LP metadata from ${lpStorageAddress}:`, err.message);
    return null;
  }
}

/**
 * Get all LP storage accounts for a specific pool
 * Scans for STORAGE accounts with LP naming pattern
 *
 * @param {string} poolAddress - Pool address
 * @returns {Promise<Array<{ address: string, shares: bigint, owner: string }>>}
 */
export async function getLPPositionsForPool(poolAddress) {
  const client = await getOpsClient();
  const positions = [];

  try {
    // Use the pool's last 8 characters to find matching LP accounts
    const poolShort = poolAddress.slice(-8).toUpperCase().replace(/[^A-Z]/g, '');

    // In production, we'd query the blockchain for accounts matching the pattern LP_{poolShort}_*
    // For now, we return the positions stored in the pool's internal tracking
    // This is a simplified approach - full implementation would require blockchain indexing

    console.log(`📊 Scanning for LP positions for pool ${poolAddress.slice(-8)}...`);

    // TODO: Implement blockchain scanning for accounts matching pattern
    // For now, we rely on the pool's internal lpAccounts Map which gets migrated to on-chain

    return positions;
  } catch (err) {
    console.error(`❌ Error scanning LP positions:`, err.message);
    return [];
  }
}

export { KeetaNet };
