/**
 * Keeta FX Swap Service
 *
 * Provides atomic SWAP transactions using the FX SDK.
 * This integrates with the Silverback FX resolver to enable
 * single-transaction swaps like the Keythings wallet.
 */

import { FX } from '@keetanetwork/anchor';
import Resolver from '@keetanetwork/anchor/lib/resolver.js';
import * as KeetaNet from '@keetanetwork/keetanet-client';

// Silverback FX Resolver Account
export const SILVERBACK_RESOLVER = 'keeta_asnqu5qxwxq2rhuh77s3iciwhtvra2n7zxviva2ukwqbbxkwxtlqhle5cgcjm';

// Network configuration
const NETWORK = import.meta.env.VITE_KEETA_NETWORK || 'main';

export interface FXSwapQuote {
  from: string;
  to: string;
  amountIn: bigint;
  amountOut: bigint;
  cost: bigint;
  costToken: string;
  providerID: string;
  account: string; // Pool address
  rawQuote: any; // For createExchange
}

export interface FXSwapResult {
  success: boolean;
  exchangeID?: string;
  error?: string;
}

/**
 * Create FX Client configured with Silverback resolver
 *
 * The FX SDK requires a UserClient with signing capabilities.
 * Keythings provides this via getUserClient().
 */
export function createSilverbackFXClient(userClient: any): any {
  // The userClient from Keythings should have:
  // - client: underlying network client
  // - account: user's account
  // - signer: signing capability

  // Create resolver pointing to our Silverback resolver account
  // Use the userClient directly as the resolver's client
  const resolverConfig = {
    client: userClient,
    root: KeetaNet.lib.Account.fromPublicKeyString(SILVERBACK_RESOLVER),
    trustedCAs: [],
    network: NETWORK as 'test' | 'main',
  };

  const resolver = new Resolver(resolverConfig);

  // Create FX Client with UserClient + resolver
  // The SDK should detect it's a UserClient and use its signer
  return new FX.Client(userClient, {
    resolver,
    network: NETWORK as 'test' | 'main',
  });
}

/**
 * Alternative: Create FX Client for estimates only (no signing required)
 * Use this if the signer check fails
 */
export async function createFXClientForEstimates(userClient: any): Promise<any> {
  // Extract the underlying network client for read-only operations
  const networkClient = userClient?.client || userClient;

  const resolverConfig = {
    client: networkClient,
    root: KeetaNet.lib.Account.fromPublicKeyString(SILVERBACK_RESOLVER),
    trustedCAs: [],
    network: NETWORK as 'test' | 'main',
  };

  const resolver = new Resolver(resolverConfig);

  // For estimates, we may be able to use a client without full signing capability
  // This is a fallback approach
  return new FX.Client(networkClient, {
    resolver,
    network: NETWORK as 'test' | 'main',
  });
}

/**
 * Get quotes from Silverback FX resolver via direct HTTP
 * This bypasses the FX SDK's signer requirement for quote fetching
 */
export async function getFXSwapQuotes(
  userClient: any,
  fromToken: string,
  toToken: string,
  amount: bigint,
  affinity: 'from' | 'to' = 'from'
): Promise<FXSwapQuote[]> {
  try {
    // Debug: Log userClient structure
    console.log('🔍 UserClient structure:', {
      hasClient: !!userClient?.client,
      hasAccount: !!userClient?.account,
      hasSigner: !!userClient?.signer,
      hasNetwork: !!userClient?.network,
      type: userClient?.constructor?.name,
    });

    // Call our FX server endpoint directly to get quotes
    // This avoids the SDK's signer requirement for just fetching quotes
    // FX routes are mounted at /fx, not /api/fx
    const FX_BASE = `${window.location.origin}/fx`;

    console.log('🔍 Fetching FX quote from Silverback server...');

    const response = await fetch(`${FX_BASE}/api/getQuote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request: {
          from: fromToken,
          to: toToken,
          amount: amount.toString(),
          affinity,
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ FX quote request failed:', response.status, errorText);
      return [];
    }

    const result = await response.json();
    console.log('📊 FX quote response:', result);

    if (!result || result.error) {
      console.log('⚠️ No FX quote available:', result?.error);
      return [];
    }

    // Parse the quote from server response
    // The server returns the quote in SDK format
    const quote = result.quote || result;

    const fxQuote: FXSwapQuote = {
      from: fromToken,
      to: toToken,
      amountIn: amount,
      amountOut: BigInt(quote.convertedAmount || quote.quote?.convertedAmount || '0'),
      cost: BigInt(quote.cost?.amount || quote.quote?.cost?.amount || '0'),
      costToken: fromToken, // Cost is typically in input token
      providerID: 'silverback',
      account: quote.account || quote.quote?.account || '',
      rawQuote: result, // Store full response for createExchange
    };

    console.log(`✅ FX quote: ${formatAmount(fxQuote.amountIn)} → ${formatAmount(fxQuote.amountOut)}`);

    return [fxQuote];
  } catch (error: any) {
    console.error('❌ Failed to get FX quotes:', error);
    return [];
  }
}

/**
 * Execute atomic FX swap
 *
 * This creates an atomic SWAP transaction:
 * 1. User builds a block with SEND (to pool) + RECEIVE (from pool) instructions
 * 2. User signs via Keythings
 * 3. Block is sent to FX server's createExchange endpoint
 * 4. Server completes the swap atomically
 */
export async function executeFXSwap(
  quote: FXSwapQuote,
  userClient: any
): Promise<FXSwapResult> {
  try {
    console.log('🚀 Executing atomic FX swap...');
    console.log(`   Pool: ${quote.account.slice(-12)}`);
    console.log(`   Amount In: ${quote.amountIn.toString()}`);
    console.log(`   Amount Out: ${quote.amountOut.toString()}`);

    if (!userClient) {
      throw new Error('User client required for swap execution');
    }

    // Build atomic SWAP block: SEND to pool + RECEIVE from pool
    const builder = userClient.initBuilder();

    // Get account objects for the tokens and pool
    const tokenInAccount = KeetaNet.lib.Account.fromPublicKeyString(quote.from);
    const tokenOutAccount = KeetaNet.lib.Account.fromPublicKeyString(quote.to);
    const poolAccount = KeetaNet.lib.Account.fromPublicKeyString(quote.account);

    // SEND: User sends amountIn of tokenIn to pool
    builder.send(poolAccount, quote.amountIn, tokenInAccount);

    // RECEIVE: User expects to receive amountOut of tokenOut from pool
    // This creates the atomic swap condition
    builder.receive(poolAccount, quote.amountOut, tokenOutAccount);

    console.log('📝 Built atomic SWAP block, requesting signature...');

    // Sign and publish via Keythings (will prompt user)
    await userClient.publishBuilder(builder);

    // Extract block hash for tracking
    let blockHash = null;
    if (builder.blocks && builder.blocks.length > 0) {
      const block = builder.blocks[0];
      if (block?.hash) {
        blockHash = typeof block.hash === 'string'
          ? block.hash
          : block.hash.toString?.('hex') || block.hash.toString?.();
      }
    }

    console.log('✅ Atomic FX swap completed!');
    console.log(`   Block Hash: ${blockHash || 'N/A'}`);

    return {
      success: true,
      exchangeID: blockHash,
    };
  } catch (error: any) {
    console.error('❌ FX swap failed:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Get estimates (faster than quotes, less precise)
 */
export async function getFXSwapEstimates(
  userClient: any,
  fromToken: string,
  toToken: string,
  amount: bigint,
  affinity: 'from' | 'to' = 'from'
): Promise<any[]> {
  try {
    const fxClient = createSilverbackFXClient(userClient);

    const conversionRequest = {
      from: fromToken,
      to: toToken,
      amount: amount,
      affinity,
    };

    const estimates = await fxClient.getEstimates(conversionRequest);

    if (!estimates || estimates.length === 0) {
      return [];
    }

    return estimates.map((estimateWrapper: any) => ({
      convertedAmount: estimateWrapper.estimate.convertedAmount,
      expectedCost: estimateWrapper.estimate.expectedCost,
      providerID: estimateWrapper.provider?.providerID || 'silverback',
    }));
  } catch (error: any) {
    console.error('❌ Failed to get FX estimates:', error);
    return [];
  }
}

/**
 * Format amount for display
 */
export function formatAmount(amount: bigint, decimals: number = 9): string {
  const divisor = BigInt(Math.pow(10, decimals));
  const wholePart = amount / divisor;
  const fractionalPart = amount % divisor;

  // Pad fractional part with leading zeros
  const fractionalStr = fractionalPart.toString().padStart(decimals, '0');

  // Remove trailing zeros but keep at least 2 decimal places
  const trimmed = fractionalStr.replace(/0+$/, '').padEnd(2, '0');

  return `${wholePart}.${trimmed.slice(0, 6)}`;
}
