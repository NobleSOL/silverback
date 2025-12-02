/**
 * Keeta FX Anchor Service
 * Provides access to FX anchor liquidity for token swaps
 */

import { FX } from '@keetanetwork/anchor';
import Resolver from '@keetanetwork/anchor/lib/resolver.js';
import * as KeetaNet from '@keetanetwork/keetanet-client';
import type { UserClient } from '@keetanetwork/keetanet-client';

// API base URL - use environment variable or default to current origin
const API_BASE = import.meta.env.VITE_KEETA_API_BASE || `${window.location.origin}/api`;

// Silverback FX Resolver - our default resolver for anchor swaps
const SILVERBACK_RESOLVER = 'keeta_asnqu5qxwxq2rhuh77s3iciwhtvra2n7zxviva2ukwqbbxkwxtlqhle5cgcjm';

// Network configuration
const NETWORK = import.meta.env.VITE_KEETA_NETWORK || 'main';

export type AnchorQuote = {
  from: string; // Token address
  to: string; // Token address
  amountIn: string; // Human-readable amount
  amountOut: string; // Human-readable amount
  amountOutAtomic: bigint; // Atomic units
  priceImpact: number;
  fee: string; // Fee in token terms
  providerID: string; // 'FX Anchor' or 'Silverback'
  poolAddress?: string; // For Silverback pools
  feeBps?: number; // For Silverback pools
  rawQuote: any; // Keep raw quote for execution
};

export type AnchorEstimate = {
  from: string;
  to: string;
  amountIn: string;
  estimatedOut: string;
  expectedCost: {
    min: string;
    max: string;
    token: string;
  };
  providerID: string;
};

/**
 * Initialize FX Anchor client with Silverback resolver
 * This allows anchor swaps to work without users configuring a resolver
 */
export function createFXClient(userClient: any, config?: any): any {
  try {
    // Create resolver pointing to Silverback's FX resolver account
    const resolverConfig = {
      client: userClient,
      root: KeetaNet.lib.Account.fromPublicKeyString(SILVERBACK_RESOLVER),
      trustedCAs: [],
      network: NETWORK as 'test' | 'main',
    };

    const resolver = new Resolver(resolverConfig);

    // Create FX Client with UserClient + Silverback resolver
    return new FX.Client(userClient, {
      ...config,
      resolver,
      network: NETWORK as 'test' | 'main' | 'staging' | 'dev',
    });
  } catch (error) {
    console.warn('Failed to create FX client with resolver, falling back to default:', error);
    // Fallback without resolver
    return new FX.Client(userClient, {
      ...config,
      network: NETWORK as 'test' | 'main' | 'staging' | 'dev',
    });
  }
}

/**
 * Get anchor quotes for a token swap
 * Queries the FX server directly for atomic swap quotes
 * Returns quotes that can be executed as proper SWAP transactions
 */
export async function getAnchorQuotes(
  userClient: any,
  fromToken: string,
  toToken: string,
  amount: bigint,
  decimalsFrom: number = 9,
  decimalsTo: number = 9
): Promise<AnchorQuote[]> {
  try {
    console.log('📊 Fetching FX quotes:', {
      from: fromToken.slice(0, 12) + '...',
      to: toToken.slice(0, 12) + '...',
      amount: amount.toString(),
    });

    const allQuotes: AnchorQuote[] = [];

    // 1. Fetch quotes directly from our FX server (atomic swap support)
    try {
      console.log('🔍 Calling FX server directly for atomic swap quote...');

      const fxResponse = await fetch(`${API_BASE.replace('/api', '')}/fx/api/getQuote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request: {
            from: fromToken,
            to: toToken,
            amount: amount.toString(),
            affinity: 'from',
          },
        }),
      });

      if (fxResponse.ok) {
        const data = await fxResponse.json();
        console.log('📋 FX server response:', data);

        if (data.ok && data.quote) {
          // Parse converted amount (handles hex format)
          let convertedAmount = data.quote.convertedAmount;
          if (typeof convertedAmount === 'string') {
            convertedAmount = convertedAmount.startsWith('0x')
              ? BigInt(convertedAmount)
              : BigInt(convertedAmount);
          }

          // Parse cost amount
          let costAmount = data.quote.cost?.amount || '0';
          if (typeof costAmount === 'string' && costAmount.startsWith('0x')) {
            costAmount = BigInt(costAmount);
          } else {
            costAmount = BigInt(costAmount);
          }

          const amountInHuman = Number(amount) / Math.pow(10, decimalsFrom);
          const amountOutHuman = Number(convertedAmount) / Math.pow(10, decimalsTo);
          const feeHuman = Number(costAmount) / Math.pow(10, decimalsFrom);

          const fxQuote: AnchorQuote = {
            from: fromToken,
            to: toToken,
            amountIn: amountInHuman.toFixed(6),
            amountOut: amountOutHuman.toFixed(6),
            amountOutAtomic: convertedAmount,
            priceImpact: 0.1, // FX anchors have low impact
            fee: feeHuman.toFixed(6),
            providerID: 'FX Anchor',
            poolAddress: data.quote.account,
            rawQuote: data.quote, // Keep signed quote for createExchange
          };

          allQuotes.push(fxQuote);
          console.log(`✅ FX Anchor quote: ${fxQuote.amountIn} → ${fxQuote.amountOut}`);
        }
      } else {
        const errorText = await fxResponse.text();
        console.log('⚠️ FX server returned error:', fxResponse.status, errorText);
      }
    } catch (fxError) {
      console.warn('⚠️ FX server quote fetch failed:', fxError);
    }

    // 2. Sort all quotes by best output (descending)
    allQuotes.sort((a, b) => {
      const outA = Number(a.amountOut);
      const outB = Number(b.amountOut);
      return outB - outA; // Descending: best first
    });

    if (allQuotes.length === 0) {
      console.log('⚠️ No FX quotes available');
      return [];
    }

    console.log(`✅ Total quotes available: ${allQuotes.length} (best: ${allQuotes[0].providerID})`);
    return allQuotes;
  } catch (error) {
    console.error('❌ Failed to get quotes:', error);
    return [];
  }
}

/**
 * Get anchor estimates (faster than quotes, less precise)
 */
export async function getAnchorEstimates(
  userClient: any,
  fromToken: string,
  toToken: string,
  amount: bigint,
  decimalsFrom: number = 9,
  decimalsTo: number = 9
): Promise<AnchorEstimate[]> {
  try {
    const fxClient = createFXClient(userClient);

    // FX SDK expects token addresses as strings
    const conversionRequest = {
      from: fromToken,
      to: toToken,
      amount: amount,
      affinity: 'from' as const,
    };

    const estimates = await fxClient.getEstimates(conversionRequest);

    if (!estimates || estimates.length === 0) {
      return [];
    }

    const anchorEstimates: AnchorEstimate[] = estimates.map((estimateWrapper) => {
      const estimate = estimateWrapper.estimate;
      const amountInHuman = Number(amount) / Math.pow(10, decimalsFrom);
      const estimatedOutHuman = Number(estimate.convertedAmount) / Math.pow(10, decimalsTo);

      return {
        from: fromToken,
        to: toToken,
        amountIn: amountInHuman.toFixed(6),
        estimatedOut: estimatedOutHuman.toFixed(6),
        expectedCost: {
          min: (Number(estimate.expectedCost.min) / Math.pow(10, decimalsFrom)).toFixed(6),
          max: (Number(estimate.expectedCost.max) / Math.pow(10, decimalsFrom)).toFixed(6),
          token: estimate.expectedCost.token.publicKeyString.get(),
        },
        providerID: 'anchor',
      };
    });

    return anchorEstimates;
  } catch (error) {
    console.error('❌ Failed to get anchor estimates:', error);
    return [];
  }
}

/**
 * Execute anchor swap using a quote
 * Creates an atomic SWAP transaction via the FX server's createExchange endpoint
 * This results in a proper "SWAP" transaction, not two "SEND" transactions
 * @throws Error if swap execution fails
 */
export async function executeAnchorSwap(
  anchorQuote: AnchorQuote,
  userClient: any,
  userAddress?: string
): Promise<{ success: boolean; exchangeID?: string }> {
  console.log(`🚀 Executing FX Anchor atomic swap...`);
  console.log('📋 Quote details:', {
    providerID: anchorQuote.providerID,
    from: anchorQuote.from,
    to: anchorQuote.to,
    amountIn: anchorQuote.amountIn,
    amountOut: anchorQuote.amountOut,
    poolAddress: anchorQuote.poolAddress,
    hasRawQuote: !!anchorQuote.rawQuote,
  });

  if (!anchorQuote.rawQuote) {
    throw new Error('Invalid anchor quote - missing raw quote data');
  }

  if (!userClient) {
    throw new Error('User client required for FX swaps');
  }

  const signedQuote = anchorQuote.rawQuote;
  console.log('📋 Signed quote from FX server:', signedQuote);

  // Validate quote has required fields
  if (!signedQuote.request || !signedQuote.account || !signedQuote.signed) {
    throw new Error('Invalid quote: missing required fields (request, account, or signed)');
  }

  try {
    // Step 1: Build the swap request block using UserClient
    // This creates a block that sends tokens to the pool
    console.log('📝 Building swap request block...');

    // Parse the amount from the quote request
    const amountIn = BigInt(signedQuote.request.amount);
    const tokenIn = signedQuote.request.from;
    const poolAccount = signedQuote.account;

    console.log('   Token In:', tokenIn);
    console.log('   Amount In:', amountIn.toString());
    console.log('   Pool Account:', poolAccount);

    // Build the swap request using UserClient
    // This creates a special block format that the FX server expects
    const builder = userClient.initBuilder();
    builder.send(poolAccount, amountIn, tokenIn);

    // Get the block without publishing
    await builder.computeBlocks();
    const blocks = builder.blocks;

    if (!blocks || blocks.length === 0) {
      throw new Error('Failed to build swap block');
    }

    // Get the block as string for the FX server
    const swapBlock = blocks[0];
    const blockString = swapBlock.toString();

    console.log('✅ Swap block built');
    console.log('   Block hash:', swapBlock.hash?.toString() || 'pending');

    // Step 2: Call FX server's createExchange endpoint
    // The server will validate the quote, accept the swap, and complete it atomically
    console.log('📡 Calling FX server createExchange...');

    const response = await fetch(`${API_BASE.replace('/api', '')}/fx/api/createExchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request: {
          quote: signedQuote,
          block: blockString,
        },
      }),
    });

    console.log('📡 Response status:', response.status);
    const data = await response.json();
    console.log('📡 Response data:', data);

    if (!response.ok || !data.ok) {
      throw new Error(data.error || 'FX createExchange failed');
    }

    console.log('✅ FX Anchor atomic swap completed!');
    console.log('   Exchange ID:', data.exchangeID);

    return {
      success: true,
      exchangeID: data.exchangeID,
    };
  } catch (error: any) {
    console.error('❌ FX Anchor swap failed:', error);
    throw new Error(`FX Anchor swap failed: ${error.message}`);
  }
}

/**
 * Check status of an anchor exchange
 */
export async function getExchangeStatus(
  anchorQuote: AnchorQuote,
  exchangeID: string
): Promise<{ status: string; error?: string }> {
  try {
    if (!anchorQuote.rawQuote) {
      throw new Error('Invalid anchor quote');
    }

    const exchange = await anchorQuote.rawQuote.createExchange();
    const status = await exchange.getExchangeStatus();

    return {
      status: 'completed', // We can enhance this with actual status
    };
  } catch (error: any) {
    console.error('❌ Failed to check exchange status:', error);
    return {
      status: 'error',
      error: error.message,
    };
  }
}

/**
 * List available conversion pairs from anchors
 */
export async function listAvailableConversions(
  userClient: any,
  fromToken: string
): Promise<string[]> {
  try {
    const fxClient = createFXClient(userClient);

    // FX SDK expects token address as string
    const result = await fxClient.listPossibleConversions({
      from: fromToken,
    });

    if (!result || !result.conversions) {
      return [];
    }

    return result.conversions;
  } catch (error) {
    console.error('❌ Failed to list conversions:', error);
    return [];
  }
}
