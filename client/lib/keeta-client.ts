// Client-side Keeta blockchain utilities
// Fetches data directly from Keeta network without backend

import * as KeetaSDK from '@keetanetwork/keetanet-client';
import { calculateSwapQuote as calculateSwapQuoteAMM } from './amm-math';

const KEETA_NODE = 'https://api.test.keeta.com';
const KEETA_NETWORK = 'test';

/**
 * Create a UserClient for read-only operations (no signing)
 */
export function createKeetaClient() {
  return KeetaSDK.UserClient.fromNetwork(KEETA_NETWORK as any, null);
}

/**
 * Convert hex string to Uint8Array (browser-compatible)
 * Also handles validation to ensure we get exactly 32 bytes
 */
function hexToBytes(hex: string): Uint8Array {
  // Remove any whitespace
  const cleanHex = hex.trim();

  // Check if it's a valid hex string (64 characters = 32 bytes)
  if (!/^[0-9a-fA-F]{64}$/.test(cleanHex)) {
    console.error('❌ Invalid seed format. Expected 64 hex characters, got:', cleanHex.length, 'characters');
    console.error('Seed preview:', cleanHex.substring(0, 20) + '...');
    throw new Error(`Invalid seed: must be 64 hex characters (32 bytes). Got ${cleanHex.length} characters.`);
  }

  const bytes = new Uint8Array(32);
  for (let i = 0; i < 64; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substr(i, 2), 16);
  }
  return bytes;
}

/**
 * Create a UserClient from a seed for signing transactions
 */
export function createKeetaClientFromSeed(seed: string, accountIndex: number = 0) {
  try {
    console.log('🔧 Creating client from seed...');
    const seedBytes = hexToBytes(seed);
    console.log('✅ Seed bytes created:', seedBytes.length, 'bytes');

    // Try to access Account class
    if (!KeetaSDK.lib || !KeetaSDK.lib.Account) {
      console.error('❌ KeetaSDK.lib.Account not available!');
      console.log('Available in KeetaSDK:', Object.keys(KeetaSDK).slice(0, 20));
      if (KeetaSDK.lib) {
        console.log('Available in KeetaSDK.lib:', Object.keys(KeetaSDK.lib));
      }
      throw new Error('Account class not available in SDK');
    }

    console.log('✅ Account class found');
    const account = KeetaSDK.lib.Account.fromSeed(seedBytes, accountIndex);
    console.log('✅ Account created');

    return KeetaSDK.UserClient.fromNetwork(KEETA_NETWORK as any, account);
  } catch (error) {
    console.error('❌ Error in createKeetaClientFromSeed:', error);
    throw error;
  }
}

/**
 * Get account address from seed
 */
export function getAddressFromSeed(seed: string, accountIndex: number = 0): string {
  try {
    console.log('🔧 Getting address from seed...');
    const seedBytes = hexToBytes(seed);

    if (!KeetaSDK.lib || !KeetaSDK.lib.Account) {
      throw new Error('Account class not available in SDK');
    }

    const account = KeetaSDK.lib.Account.fromSeed(seedBytes, accountIndex);
    return account.publicKeyString.get();
  } catch (error) {
    console.error('❌ Error in getAddressFromSeed:', error);
    throw error;
  }
}

/**
 * Generate a new wallet (client-side) - with hex seed
 */
export function generateWallet(): { seed: string; address: string } {
  const crypto = window.crypto || (window as any).msCrypto;
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);

  const seed = Array.from(randomBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  const address = getAddressFromSeed(seed);

  return { seed, address };
}

/**
 * Fetch token balances for an address using a seed
 * Note: This requires the seed to create a UserClient instance
 */
export async function fetchBalances(seed: string, accountIndex: number = 0) {
  try {
    console.log('🔍 fetchBalances called');

    // Create account from seed
    const seedBytes = hexToBytes(seed);
    const account = KeetaSDK.lib.Account.fromSeed(seedBytes, accountIndex);
    const address = account.publicKeyString.get();
    console.log('✅ Account created:', address);

    // Create client
    const client = KeetaSDK.UserClient.fromNetwork(KEETA_NETWORK as any, account);
    console.log('✅ Client created');

    // Fetch balances - pass account object as parameter
    const rawBalances = await client.allBalances({ account });
    console.log('✅ Raw balances from blockchain:', rawBalances);

    // Format balances with metadata
    const formattedBalances = await Promise.all(
      rawBalances.map(async (b: any) => {
        try {
          // Extract token address from Account object
          const tokenAddress = b.token.publicKeyString?.toString() ?? b.token.toString();
          const balanceValue = BigInt(b.balance ?? 0n);

          console.log(`  Token: ${tokenAddress}, Balance: ${balanceValue}`);

          const metadata = await fetchTokenMetadata(tokenAddress);
          const rawBalance = Number(balanceValue);
          const decimals = metadata.decimals || 9;
          const balanceFormatted = rawBalance / (10 ** decimals);

          return {
            address: tokenAddress,
            symbol: metadata.symbol,
            balance: balanceValue.toString(),
            balanceFormatted: balanceFormatted.toFixed(decimals),
            decimals
          };
        } catch (err) {
          console.error('Error formatting balance:', err);
          return {
            address: 'unknown',
            symbol: 'ERROR',
            balance: '0',
            balanceFormatted: '0.000000000',
            decimals: 9
          };
        }
      })
    );

    return formattedBalances;
  } catch (error) {
    console.error('Error fetching balances:', error);
    return [];
  }
}

/**
 * Fetch token metadata (symbol, decimals)
 * Uses the same pattern as server-side code
 */
export async function fetchTokenMetadata(tokenAddress: string) {
  // Check known tokens first (hardcoded fallback)
  const knownTokens: Record<string, { symbol: string; decimals: number }> = {
    'keeta_anyiff4v34alvumupagmdyosydeq24lc4def5mrpmmyhx3j6vj2uucckeqn52': { symbol: 'KTA', decimals: 9 },
    'keeta_ant6bsl2obpmreopln5e242s3ihxyzjepd6vbkeoz3b3o3pxjtlsx3saixkym': { symbol: 'WAVE', decimals: 9 },
    'keeta_anchh4m5ukgvnx5jcwe56k3ltgo4x4kppicdjgcaftx4525gdvknf73fotmdo': { symbol: 'RIDE', decimals: 5 },
    'keeta_apkuewquwvrain2g7nkgqaobpiqy77qosl52dfheqyhbt4dfozdn5lmzmqh7w': { symbol: 'TEST', decimals: 9 },
  };

  const known = knownTokens[tokenAddress];
  if (known) {
    return known;
  }

  try {
    const client = createKeetaClient();

    console.log(`🔍 Fetching metadata for: ${tokenAddress.slice(0, 20)}...`);

    // Use getAccountInfo (singular) which is available in the client SDK
    const accountInfo = await client.getAccountInfo(tokenAddress);
    console.log(`📊 Raw accountInfo response for ${tokenAddress.slice(0, 20)}...:`, accountInfo);

    if (accountInfo?.info) {
      // Get symbol from info.name (Keeta stores token symbol here)
      const symbol = accountInfo.info.name || tokenAddress.slice(0, 8) + '...';
      console.log(`  Symbol from info.name: ${symbol}`);

      // Get decimals from metadata object
      let decimals = 9; // Default
      if (accountInfo.info.metadata) {
        try {
          // Metadata is base64 encoded
          const metadataStr = atob(accountInfo.info.metadata);
          const metaObj = JSON.parse(metadataStr);
          console.log(`  Parsed metadata:`, metaObj);
          decimals = Number(metaObj.decimalPlaces || metaObj.decimals || 9);
        } catch (parseErr) {
          console.warn(`Could not parse metadata for ${tokenAddress.slice(0, 12)}...`);
        }
      }

      console.log(`✅ Final metadata: ${symbol}, ${decimals} decimals`);
      return { symbol, decimals };
    }
  } catch (error) {
    console.warn(`Could not fetch metadata for ${tokenAddress.slice(0, 12)}...:`, error);
  }

  // Default values if metadata not found
  return {
    symbol: tokenAddress.slice(0, 8) + '...',
    decimals: 9
  };
}

/**
 * Fetch pool reserves directly from blockchain
 * Queries the pool account's token balances
 */
async function fetchPoolReserves(poolAddress: string, tokenA: string, tokenB: string) {
  try {
    // Create a temporary account from the pool address to query its balances
    const client = createKeetaClient();
    const poolAccount = KeetaSDK.lib.Account.fromPublicKeyString(poolAddress);

    // Query balances for the pool account
    const rawBalances = await client.allBalances({ account: poolAccount });

    // Extract token balances
    let reserveA = 0n;
    let reserveB = 0n;

    for (const b of rawBalances) {
      const tokenAddr = b.token.publicKeyString?.toString() ?? b.token.toString();
      const balance = BigInt(b.balance ?? 0n);

      if (tokenAddr === tokenA) {
        reserveA = balance;
      } else if (tokenAddr === tokenB) {
        reserveB = balance;
      }
    }

    return { reserveA, reserveB };
  } catch (error) {
    console.warn(`Could not fetch reserves for pool ${poolAddress}:`, error);
    return { reserveA: 0n, reserveB: 0n };
  }
}

/**
 * Fetch available pools with live reserves and LP token supply from blockchain
 */
export async function fetchPools() {
  try {
    // Fetch pools from backend API (for pool list and metadata)
    const API_BASE = import.meta.env.VITE_KEETA_API_BASE || `${window.location.origin}/api`;
    console.log('🔍 fetchPools - API_BASE:', API_BASE);

    const fullUrl = `${API_BASE}/pools`;
    console.log('🔍 fetchPools - Fetching from:', fullUrl);

    const response = await fetch(fullUrl);
    console.log('🔍 fetchPools - Response status:', response.status, response.statusText);

    if (!response.ok) {
      throw new Error(`Failed to fetch pools: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('🔍 fetchPools - Response data:', data);

    if (!data.success || !data.pools) {
      throw new Error('Invalid pools response from API');
    }

    console.log(`✅ fetchPools - Successfully fetched ${data.pools.length} pools`);

    // Create client for querying LP token supplies
    const client = createKeetaClient();

    // Enhance pool data with on-chain LP token total supply
    const poolsWithLPSupply = await Promise.all(
      data.pools.map(async (pool: any) => {
        let totalLPSupply = '0';

        // Try to fetch the actual LP token total supply from blockchain
        if (pool.lpTokenAddress) {
          try {
            console.log(`🔍 Fetching LP token supply for pool ${pool.poolAddress.slice(-8)}: ${pool.lpTokenAddress.slice(-8)}`);

            // Get LP token account info to check its supply
            // Handle both browser and Node.js SDK structures
            let lpTokenInfo;
            if ((client as any).client?.getAccountsInfo) {
              const accountsInfo = await (client as any).client.getAccountsInfo([pool.lpTokenAddress]);
              lpTokenInfo = accountsInfo[pool.lpTokenAddress];
            } else if ((client as any).getAccountsInfo) {
              const accountsInfo = await (client as any).getAccountsInfo([pool.lpTokenAddress]);
              lpTokenInfo = accountsInfo[pool.lpTokenAddress];
            }

            if (lpTokenInfo?.info?.supply) {
              totalLPSupply = lpTokenInfo.info.supply.toString();
              console.log(`✅ LP token supply from chain: ${totalLPSupply}`);
            }
          } catch (err) {
            console.warn(`Could not fetch LP supply for pool ${pool.poolAddress.slice(-8)}:`, err);
          }
        }

        // Fall back to backend's totalLPSupply if we couldn't fetch from chain
        if (totalLPSupply === '0' && pool.totalLPSupply) {
          totalLPSupply = pool.totalLPSupply;
          console.log(`📊 Using backend totalLPSupply: ${totalLPSupply}`);
        }

        return {
          poolAddress: pool.poolAddress,
          lpTokenAddress: pool.lpTokenAddress,
          tokenA: pool.tokenA,
          tokenB: pool.tokenB,
          symbolA: pool.symbolA,
          symbolB: pool.symbolB,
          decimalsA: pool.decimalsA,
          decimalsB: pool.decimalsB,
          reserveA: pool.reserveA,
          reserveB: pool.reserveB,
          reserveAHuman: pool.reserveAHuman,
          reserveBHuman: pool.reserveBHuman,
          totalShares: totalLPSupply,
          priceAtoB: pool.priceAtoB,
          priceBtoA: pool.priceBtoA,
        };
      })
    );

    return poolsWithLPSupply;
  } catch (error) {
    console.error('❌ Error fetching pools:', error);
    return [];
  }
}

/**
 * Fetch user's liquidity positions DIRECTLY FROM BLOCKCHAIN
 * This queries the user's LP token balances on-chain (no backend required!)
 */
export async function fetchLiquidityPositions(seed: string, accountIndex: number = 0) {
  try {
    console.log('🔍 Fetching liquidity positions from blockchain...');

    // Create account from seed
    const seedBytes = hexToBytes(seed);
    const account = KeetaSDK.lib.Account.fromSeed(seedBytes, accountIndex);
    const userAddress = account.publicKeyString.get();
    console.log('📍 User address:', userAddress);

    // Create client
    const client = KeetaSDK.UserClient.fromNetwork(KEETA_NETWORK as any, account);

    // Fetch all token balances
    const rawBalances = await client.allBalances({ account });
    console.log(`📊 Found ${rawBalances.length} token balances on-chain`);

    // Filter for LP tokens and extract position data
    const positions = [];

    for (const b of rawBalances) {
      try {
        const tokenAddress = b.token.publicKeyString?.toString() ?? b.token.toString();
        const balanceValue = BigInt(b.balance ?? 0n);

        // Skip if balance is zero
        if (balanceValue === 0n) continue;

        // Fetch token metadata to check if it's an LP token
        console.log(`🔍 Checking token ${tokenAddress.slice(0, 20)}...`);

        // Try to get account info - handle both browser and Node.js SDK structures
        let accountInfo;
        try {
          // Try nested client first (Node.js structure)
          if ((client as any).client?.getAccountsInfo) {
            const accountsInfo = await (client as any).client.getAccountsInfo([tokenAddress]);
            accountInfo = accountsInfo[tokenAddress];
          }
          // Fall back to direct method (browser structure)
          else if ((client as any).getAccountsInfo) {
            const accountsInfo = await (client as any).getAccountsInfo([tokenAddress]);
            accountInfo = accountsInfo[tokenAddress];
          }
          else {
            console.log(`  ❌ getAccountsInfo not available, skipping`);
            continue;
          }
        } catch (err) {
          console.log(`  ❌ Error fetching account info: ${err}, skipping`);
          continue;
        }

        if (!accountInfo?.info?.metadata) {
          console.log(`  ❌ No metadata, skipping`);
          continue;
        }

        // Decode metadata
        let metadata;
        try {
          const metadataStr = atob(accountInfo.info.metadata);
          metadata = JSON.parse(metadataStr);
        } catch (err) {
          console.log(`  ❌ Could not parse metadata, skipping`);
          continue;
        }

        // Check if this is an LP token
        if (metadata.type !== 'LP_TOKEN') {
          console.log(`  ❌ Not an LP token (type: ${metadata.type}), skipping`);
          continue;
        }

        console.log(`  ✅ Found LP token! Pool: ${metadata.pool}`);

        // Query pool data DIRECTLY from blockchain (don't rely on backend!)
        const poolAddress = metadata.pool;
        const tokenA = metadata.tokenA;
        const tokenB = metadata.tokenB;

        // Fetch pool reserves from blockchain
        const poolAccount = KeetaSDK.lib.Account.fromPublicKeyString(poolAddress);
        const poolBalances = await client.allBalances({ account: poolAccount });

        let reserveA = 0n;
        let reserveB = 0n;

        for (const pb of poolBalances) {
          const pTokenAddr = pb.token.publicKeyString?.toString() ?? pb.token.toString();
          const pBalance = BigInt(pb.balance ?? 0n);

          if (pTokenAddr === tokenA) reserveA = pBalance;
          if (pTokenAddr === tokenB) reserveB = pBalance;
        }

        // Fetch token metadata for symbols
        const metadataA = await fetchTokenMetadata(tokenA);
        const metadataB = await fetchTokenMetadata(tokenB);
        const symbolA = metadataA.symbol;
        const symbolB = metadataB.symbol;
        const decimalsA = metadataA.decimals || 9;
        const decimalsB = metadataB.decimals || 9;

        // Get LP token total supply from accountInfo we already fetched
        const totalShares = BigInt(accountInfo.info?.supply || '0');
        const userShares = balanceValue;
        const sharePercent = totalShares > 0n
          ? (Number(userShares) / Number(totalShares)) * 100
          : 0;

        // Calculate user's amounts of tokenA and tokenB
        let amountA = '0';
        let amountB = '0';

        if (totalShares > 0n) {
          const amountABigInt = (reserveA * userShares) / totalShares;
          const amountBBigInt = (reserveB * userShares) / totalShares;
          amountA = (Number(amountABigInt) / Math.pow(10, decimalsA)).toFixed(6);
          amountB = (Number(amountBBigInt) / Math.pow(10, decimalsB)).toFixed(6);
        }

        positions.push({
          poolAddress,
          lpTokenAddress: tokenAddress,
          tokenA,
          tokenB,
          symbolA,
          symbolB,
          liquidity: userShares.toString(),
          sharePercent,
          amountA,
          amountB,
          timestamp: metadata.createdAt || Date.now(),
        });

        console.log(`  📋 Position: ${sharePercent.toFixed(4)}% of ${symbolA}/${symbolB} pool`);
      } catch (err) {
        console.error('Error processing token balance:', err);
      }
    }

    console.log(`✅ Found ${positions.length} LP positions on-chain`);
    return positions;
  } catch (error) {
    console.error('Error fetching liquidity positions from blockchain:', error);
    return [];
  }
}

/**
 * Get swap quote for a token pair using CLIENT-SIDE calculation
 * This eliminates the need for backend API calls, making quotes instant
 * @param poolData - Pool data from context (avoid refetching)
 */
export function getSwapQuote(
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  poolAddress: string,
  poolData?: {
    tokenA: string;
    tokenB: string;
    reserveA: string;
    reserveB: string;
    decimalsA: number;
    decimalsB: number;
  }
): {
  amountOut: string;
  amountOutHuman: number;
  priceImpact: number;
  minimumReceived: string;
  feeAmount: string;
  feeAmountHuman: number;
} | null {
  try {
    if (!poolData) {
      console.error('Pool data not provided');
      return null;
    }

    // Determine which token is A and which is B
    const isAtoB = tokenIn === poolData.tokenA;
    const reserveIn = isAtoB ? poolData.reserveA : poolData.reserveB;
    const reserveOut = isAtoB ? poolData.reserveB : poolData.reserveA;
    const decimalsIn = isAtoB ? poolData.decimalsA : poolData.decimalsB;
    const decimalsOut = isAtoB ? poolData.decimalsB : poolData.decimalsA;

    // Calculate quote using client-side AMM math (instant, no API call!)
    const quote = calculateSwapQuoteAMM(
      amountIn,
      reserveIn,
      reserveOut,
      decimalsIn,
      decimalsOut,
      0.5 // 0.5% slippage tolerance
    );

    // Convert feeAmount to human-readable
    const feeAmountHuman = Number(quote.feeAmount) / Math.pow(10, decimalsIn);

    return {
      amountOut: quote.amountOut.toString(),
      amountOutHuman: parseFloat(quote.amountOutHuman),
      priceImpact: quote.priceImpact,
      minimumReceived: quote.minimumReceived,
      feeAmount: quote.feeAmount.toString(),
      feeAmountHuman,
    };
  } catch (error) {
    console.error('Error calculating swap quote:', error);
    return null;
  }
}

/**
 * Execute a swap transaction
 */
export async function executeSwap(
  seed: string,
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  minAmountOut: string,
  poolAddress: string,
  accountIndex: number = 0
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    console.log('🔄 Executing swap...');
    console.log('  tokenIn:', tokenIn);
    console.log('  tokenOut:', tokenOut);
    console.log('  amountIn:', amountIn);
    console.log('  minAmountOut:', minAmountOut);
    console.log('  poolAddress:', poolAddress);

    // Create client from seed
    const client = createKeetaClientFromSeed(seed, accountIndex);
    const seedBytes = hexToBytes(seed);
    const account = KeetaSDK.lib.Account.fromSeed(seedBytes, accountIndex);
    const userAddress = account.publicKeyString.get();

    console.log('  userAddress:', userAddress);

    // Convert amounts to atomic units (BigInt)
    const amountInAtomic = BigInt(Math.floor(parseFloat(amountIn) * 1e9));
    const minAmountOutAtomic = BigInt(Math.floor(parseFloat(minAmountOut) * 1e9));

    // Fetch pool reserves to calculate swap output
    const quote = await getSwapQuote(tokenIn, tokenOut, amountIn, poolAddress);
    if (!quote) {
      throw new Error('Failed to get swap quote');
    }

    const amountOut = BigInt(quote.amountOut);

    // Check slippage
    if (amountOut < minAmountOutAtomic) {
      throw new Error(`Slippage too high: expected min ${minAmountOutAtomic}, got ${amountOut}`);
    }

    // Calculate fee (0.3% = 30 bps)
    const feeAmount = (amountInAtomic * 30n) / 10000n;
    const amountInAfterFee = amountInAtomic - feeAmount;

    console.log('  amountInAtomic:', amountInAtomic.toString());
    console.log('  amountOut:', amountOut.toString());
    console.log('  feeAmount:', feeAmount.toString());

    // Build transaction
    const builder = client.initBuilder();

    const tokenInAccount = KeetaSDK.lib.Account.fromPublicKeyString(tokenIn);
    const tokenOutAccount = KeetaSDK.lib.Account.fromPublicKeyString(tokenOut);
    const poolAccount = KeetaSDK.lib.Account.fromPublicKeyString(poolAddress);
    const userAccount = KeetaSDK.lib.Account.fromPublicKeyString(userAddress);

    // Treasury address
    const TREASURY_ADDRESS = 'keeta_aabtozgfunwwvwdztv54y6l5x57q2g3254shgp27zjltr2xz3pyo7q4tjtmsamy';
    const treasuryAccount = KeetaSDK.lib.Account.fromPublicKeyString(TREASURY_ADDRESS);

    // 1. User sends fee to treasury
    if (feeAmount > 0n) {
      builder.send(treasuryAccount, feeAmount, tokenInAccount);
      console.log('  ✅ Added: User sends fee to treasury');
    }

    // 2. User sends input token to pool
    builder.send(poolAccount, amountInAfterFee, tokenInAccount);
    console.log('  ✅ Added: User sends input to pool');

    // 3. Pool sends output token to user (this requires SEND_ON_BEHALF permission which pool has)
    // Note: In browser, we can't use SEND_ON_BEHALF since we don't have pool's private key
    // This transaction will fail unless the pool account grants SEND_ON_BEHALF to user
    // For now, we'll build the transaction and let it fail gracefully
    builder.send(userAccount, amountOut, tokenOutAccount, undefined, {
      account: poolAccount,
    });
    console.log('  ✅ Added: Pool sends output to user');

    // Publish transaction
    console.log('📤 Publishing transaction...');
    const result = await client.publishBuilder(builder);
    console.log('✅ Transaction published:', result);
    console.log('📦 Builder blocks:', builder.blocks);

    // Extract block hash from the second block (index 1)
    // Transaction structure:
    // Block 0: User sends fee to treasury (08AA96A7...)
    // Block 1: User sends input token to pool (BAA072F6...) <- THIS ONE for explorer
    // Block 2: Pool sends output token to user (EF0F9683...)
    let blockHash = null;
    if (builder.blocks && builder.blocks.length > 1) {
      // Use index 1 (second block) - the user sends to pool
      const block = builder.blocks[1];
      console.log('📦 Block at index 1 (user->pool):', block);
      console.log('📦 Total blocks:', builder.blocks.length);

      if (block && block.hash) {
        // Convert BlockHash to hex string
        if (typeof block.hash === 'string') {
          blockHash = block.hash.toUpperCase();
        } else if (block.hash.toString) {
          // Try toString first
          const hashStr = block.hash.toString();
          if (hashStr.match(/^[0-9A-Fa-f]+$/)) {
            blockHash = hashStr.toUpperCase();
          } else if (block.hash.toString('hex')) {
            // If toString doesn't give hex, try toString('hex')
            blockHash = block.hash.toString('hex').toUpperCase();
          }
        }
      }
    }

    console.log('✅ Block hash extracted:', blockHash);
    console.log('📊 All block hashes:', builder.blocks?.map((b, i) => ({
      index: i,
      hash: b.hash ? (typeof b.hash === 'string' ? b.hash : b.hash.toString('hex').toUpperCase()) : null
    })));

    return {
      success: true,
      blockHash: blockHash || null,
    };
  } catch (error: any) {
    console.error('❌ Swap execution error:', error);
    return {
      success: false,
      error: error.message || 'Unknown error',
    };
  }
}

/**
 * Add liquidity to a pool
 */
export async function addLiquidity(
  seed: string,
  poolAddress: string,
  tokenA: string,
  tokenB: string,
  amountADesired: string,
  amountBDesired: string,
  decimalsA: number = 9,
  decimalsB: number = 9,
  accountIndex: number = 0
): Promise<{ success: boolean; amountA?: string; amountB?: string; blockHash?: string; error?: string }> {
  try {
    console.log('💧 Adding liquidity via backend API (with on-chain LP tracking)...');
    console.log('  poolAddress:', poolAddress);
    console.log('  tokenA:', tokenA);
    console.log('  tokenB:', tokenB);
    console.log('  amountADesired:', amountADesired);
    console.log('  amountBDesired:', amountBDesired);
    console.log('  decimalsA:', decimalsA);
    console.log('  decimalsB:', decimalsB);
    console.log('  accountIndex:', accountIndex);

    // Call backend API - user sends tokens, OPS creates LP tokens (for gas)
    const API_BASE = import.meta.env.VITE_KEETA_API_BASE || `${window.location.origin}/api`;
    console.log('📡 Calling fetch to', `${API_BASE}/liquidity/add...`);
    const response = await fetch(`${API_BASE}/liquidity/add`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userSeed: seed,
        accountIndex,
        tokenA,
        tokenB,
        amountADesired,
        amountBDesired,
        amountAMin: '0',
        amountBMin: '0',
      }),
    });

    console.log('📡 Fetch completed, status:', response.status, response.statusText);
    console.log('📡 Parsing JSON response...');
    const data = await response.json();
    console.log('📡 JSON parsed:', data);

    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Failed to add liquidity');
    }

    console.log('✅ Liquidity added successfully:');
    console.log('  User address:', data.userAddress);
    console.log('  Amount A:', data.result.amountA);
    console.log('  Amount B:', data.result.amountB);
    console.log('  LP shares:', data.result.liquidity);
    console.log('  💾 LP shares are now stored on-chain in STORAGE account metadata!');

    return {
      success: true,
      amountA: data.result.amountA,
      amountB: data.result.amountB,
    };
  } catch (error: any) {
    console.error('❌ Add liquidity error:', error);
    return {
      success: false,
      error: error.message || 'Unknown error',
    };
  }
}

/**
 * Generate a deterministic pool identifier from two token addresses
 */
export function generatePoolIdentifier(tokenA: string, tokenB: string): string {
  // Sort tokens to ensure consistent identifier regardless of order
  const [token0, token1] = tokenA < tokenB ? [tokenA, tokenB] : [tokenB, tokenA];

  // Create a simple deterministic identifier using token addresses
  // In production, this would use a more sophisticated hash
  const combined = `pool_${token0.slice(-8)}_${token1.slice(-8)}`;

  return combined;
}

/**
 * Create a new pool by adding initial liquidity
 * Note: Pool won't be functional for swaps until ops account grants SEND_ON_BEHALF permission
 */
export async function createPool(
  seed: string,
  tokenA: string,
  tokenB: string,
  amountA: string,
  amountB: string,
  accountIndex: number = 0
): Promise<{ success: boolean; poolIdentifier?: string; poolAddress?: string; blockHash?: string; error?: string }> {
  try {
    console.log('🏊 Creating new pool...');

    // Generate deterministic pool identifier
    const poolIdentifier = generatePoolIdentifier(tokenA, tokenB);

    // Create client from seed
    const client = createKeetaClientFromSeed(seed, accountIndex);
    const seedBytes = hexToBytes(seed);
    const userAccount = KeetaSDK.lib.Account.fromSeed(seedBytes, accountIndex);

    // Generate pool account from identifier
    // Hash the pool identifier to get exactly 32 bytes for the seed
    const poolIdentifierBytes = new TextEncoder().encode(poolIdentifier);
    const poolSeed = await crypto.subtle.digest('SHA-256', poolIdentifierBytes);
    const poolSeedArray = new Uint8Array(poolSeed);
    const poolAccount = KeetaSDK.lib.Account.fromSeed(poolSeedArray, 0);
    const poolAddress = poolAccount.publicKeyString.get();

    console.log(`📍 Pool address: ${poolAddress}`);
    console.log(`🔑 Pool identifier: ${poolIdentifier}`);

    // Fetch token decimals
    console.log('🔍 Fetching token decimals...');
    const metadataA = await fetchTokenMetadata(tokenA);
    const metadataB = await fetchTokenMetadata(tokenB);
    const decimalsA = metadataA.decimals;
    const decimalsB = metadataB.decimals;
    console.log(`Token A decimals: ${decimalsA}, Token B decimals: ${decimalsB}`);

    // Convert amounts to atomic units using actual decimals
    const atomicAmountA = BigInt(Math.floor(parseFloat(amountA) * Math.pow(10, decimalsA)));
    const atomicAmountB = BigInt(Math.floor(parseFloat(amountB) * Math.pow(10, decimalsB)));

    // Build transaction to add initial liquidity
    const builder = client.initBuilder();
    const tokenAAccount = KeetaSDK.lib.Account.fromPublicKeyString(tokenA);
    const tokenBAccount = KeetaSDK.lib.Account.fromPublicKeyString(tokenB);

    // User sends both tokens to the new pool
    builder.send(poolAccount, atomicAmountA, tokenAAccount);
    builder.send(poolAccount, atomicAmountB, tokenBAccount);

    // Publish transaction
    const result = await client.publishBuilder(builder);

    // Extract block hash
    let blockHash = null;
    if (builder.blocks && builder.blocks.length > 1) {
      const block = builder.blocks[1];
      if (block && block.hash) {
        blockHash = typeof block.hash === 'string'
          ? block.hash.toUpperCase()
          : block.hash.toString('hex').toUpperCase();
      }
    }

    console.log('✅ Pool created with initial liquidity!');
    console.log('⚠️  Note: Pool needs SEND_ON_BEHALF permission from ops account to enable swaps');

    return {
      success: true,
      poolIdentifier,
      poolAddress,
      blockHash: blockHash || undefined,
    };
  } catch (error: any) {
    console.error('❌ Create pool error:', error);
    return {
      success: false,
      error: error.message || 'Unknown error',
    };
  }
}

/**
 * Remove liquidity from a pool
 * Note: This requires SEND_ON_BEHALF permission which the pool must have granted
 */
export async function removeLiquidity(
  seed: string,
  poolAddress: string,
  tokenA: string,
  tokenB: string,
  liquidityPercent: number,
  userShares: string,
  accountIndex: number = 0
): Promise<{ success: boolean; amountA?: string; amountB?: string; blockHash?: string; error?: string }> {
  try {
    console.log('🔥 Removing liquidity via backend API...');
    console.log('  poolAddress:', poolAddress);
    console.log('  tokenA:', tokenA);
    console.log('  tokenB:', tokenB);
    console.log('  liquidityPercent:', liquidityPercent);
    console.log('  userShares:', userShares);

    // Calculate liquidity amount to remove (shares to burn)
    const sharesToBurn = (BigInt(userShares) * BigInt(liquidityPercent)) / 100n;
    console.log('  sharesToBurn:', sharesToBurn.toString());

    // Call backend API to remove liquidity
    const API_BASE = import.meta.env.VITE_KEETA_API_BASE || `${window.location.origin}/api`;
    const response = await fetch(`${API_BASE}/liquidity/remove`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userSeed: seed,
        tokenA,
        tokenB,
        liquidity: sharesToBurn.toString(),
        amountAMin: '0',
        amountBMin: '0',
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Unknown error from backend');
    }

    console.log('✅ Liquidity removed successfully:', result);

    return {
      success: true,
      amountA: result.result?.amountA,
      amountB: result.result?.amountB,
      blockHash: result.result?.blockHash,
    };
  } catch (error: any) {
    console.error('❌ Remove liquidity error:', error);
    return {
      success: false,
      error: error.message || 'Unknown error',
    };
  }
}
