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
 * Returns quotes from multiple anchor providers (FX Anchors + Silverback pools)
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
    console.log('📊 Fetching quotes from all providers:', {
      from: fromToken.slice(0, 12) + '...',
      to: toToken.slice(0, 12) + '...',
      amount: amount.toString(),
    });

    const allQuotes: AnchorQuote[] = [];

    // 1. Fetch FX Anchor quotes
    try {
      console.log('🔍 Creating FX Client with Silverback resolver...');
      const fxClient = createFXClient(userClient);
      console.log('✅ FX Client created');

      // FX SDK expects token addresses as strings, not Account objects
      const conversionRequest = {
        from: fromToken,
        to: toToken,
        amount: amount,
        affinity: 'from' as const, // Amount is in 'from' token
      };

      console.log('🔍 Requesting FX quotes:', conversionRequest);
      const quotes = await fxClient.getQuotes(conversionRequest);
      console.log('📋 FX quotes response:', quotes);

      if (quotes && quotes.length > 0) {
        console.log(`✅ Received ${quotes.length} FX Anchor quote(s)`);
        console.log('📋 First quote wrapper:', quotes[0]);

        // Convert quotes to our format
        const fxQuotes: AnchorQuote[] = quotes.map((quoteWrapper) => {
          const quote = quoteWrapper.quote;
          const amountInHuman = Number(amount) / Math.pow(10, decimalsFrom);
          const amountOutHuman = Number(quote.convertedAmount) / Math.pow(10, decimalsTo);
          const feeHuman = Number(quote.cost.amount) / Math.pow(10, decimalsFrom);

          // Calculate price impact (rough estimate)
          // For anchors, impact is usually minimal as they provide fixed quotes
          const priceImpact = 0.1; // Anchors typically have very low impact

          return {
            from: fromToken,
            to: toToken,
            amountIn: amountInHuman.toFixed(6),
            amountOut: amountOutHuman.toFixed(6),
            amountOutAtomic: quote.convertedAmount,
            priceImpact,
            fee: feeHuman.toFixed(6),
            providerID: 'FX Anchor',
            rawQuote: quoteWrapper,
          };
        });

        allQuotes.push(...fxQuotes);
      } else {
        console.log('⚠️ No FX Anchor quotes available');
      }
    } catch (fxError) {
      console.warn('⚠️ FX Anchor quote fetch failed:', fxError);
    }

    // 2. Fetch Silverback pool quotes
    try {
      const response = await fetch(`${API_BASE}/anchor/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenIn: fromToken,
          tokenOut: toToken,
          amountIn: amount.toString(),
          decimalsIn: decimalsFrom,
          decimalsOut: decimalsTo,
        }),
      });

      if (response.ok) {
        const data = await response.json();

        if (data.success && data.quote) {
          console.log(`✅ Received Silverback quote: ${data.quote.amountOutFormatted} (fee: ${data.quote.feeBps / 100}%)`);

          // Convert Silverback quote to AnchorQuote format
          const silverbackQuote: AnchorQuote = {
            from: fromToken,
            to: toToken,
            amountIn: data.quote.amountInFormatted,
            amountOut: data.quote.amountOutFormatted,
            amountOutAtomic: BigInt(data.quote.amountOut),
            priceImpact: data.quote.priceImpact,
            fee: data.quote.fee,
            feeBps: data.quote.feeBps,
            providerID: 'Silverback',
            poolAddress: data.quote.poolAddress,
            rawQuote: data.quote, // Store full quote for execution
          };

          allQuotes.push(silverbackQuote);
        } else {
          console.log('⚠️ No Silverback pools available for this pair');
        }
      }
    } catch (sbError) {
      console.warn('⚠️ Silverback quote fetch failed:', sbError);
    }

    // 3. Sort all quotes by best output (descending)
    allQuotes.sort((a, b) => {
      const outA = Number(a.amountOut);
      const outB = Number(b.amountOut);
      return outB - outA; // Descending: best first
    });

    if (allQuotes.length === 0) {
      console.log('⚠️ No quotes available from any provider');
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
 * Routes to appropriate backend (FX Anchor SDK or Silverback service)
 * @throws Error if swap execution fails
 */
export async function executeAnchorSwap(
  anchorQuote: AnchorQuote,
  userClient?: any,
  userAddress?: string
): Promise<{ success: boolean; exchangeID?: string }> {
  console.log(`🚀 Executing ${anchorQuote.providerID} swap...`);
  console.log('📋 Quote details:', {
    providerID: anchorQuote.providerID,
    from: anchorQuote.from,
    to: anchorQuote.to,
    amountIn: anchorQuote.amountIn,
    amountOut: anchorQuote.amountOut,
    hasRawQuote: !!anchorQuote.rawQuote,
  });

  if (!anchorQuote.rawQuote) {
    throw new Error('Invalid anchor quote - missing raw quote data');
  }

  // Route to appropriate backend
  if (anchorQuote.providerID === 'Silverback') {
    // Execute via Silverback: TX1 (user signs) + TX2 (backend completes)
    if (!userClient || !userAddress) {
      throw new Error('User client and address required for Silverback swaps');
    }

    const quote = anchorQuote.rawQuote;
    console.log('📋 Silverback raw quote:', quote);

    if (!quote?.tokenIn) {
      throw new Error(`Invalid quote: missing tokenIn field`);
    }
    if (!quote?.poolAddress) {
      throw new Error(`Invalid quote: missing poolAddress field`);
    }
    if (!quote?.amountIn) {
      throw new Error(`Invalid quote: missing amountIn field`);
    }

    console.log('📝 TX1: Sending tokens to pool...');
    console.log('   Pool address:', quote.poolAddress);
    console.log('   Token In:', quote.tokenIn);
    console.log('   Amount In:', quote.amountIn);
    console.log('   Token Out:', quote.tokenOut);
    console.log('   Expected Out:', quote.amountOut);

    // TX1: User sends tokens to pool
    // Backend will complete the swap using acceptSwapRequest()
    const tx1Builder = userClient.initBuilder();
    tx1Builder.send(quote.poolAddress, BigInt(quote.amountIn), quote.tokenIn);
    await userClient.publishBuilder(tx1Builder);
    console.log('✅ TX1 completed - tokens sent to pool');

    console.log('⏳ Waiting for finalization (3s)...');

    // Wait for finalization - increased to 3s
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('📝 TX2: Requesting backend to send tokens from pool...');
    console.log('   API_BASE:', API_BASE);

    // TX2: Call backend to complete the swap
    try {
      const response = await fetch(`${API_BASE}/anchor/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quote,
          userAddress,
        }),
      });

      console.log('📡 TX2 Response status:', response.status);

      const data = await response.json();
      console.log('📡 TX2 Response data:', data);

      if (!response.ok || !data.success) {
        console.error('❌ TX2 failed:', data);
        throw new Error(data.error || 'Silverback swap TX2 failed - tokens may need recovery');
      }

      console.log('✅ Silverback swap completed');

      return {
        success: true,
        exchangeID: data.poolAddress,
      };
    } catch (tx2Error: any) {
      console.error('❌ TX2 network/fetch error:', tx2Error);
      throw new Error(`TX2 failed after TX1 completed: ${tx2Error.message}. Contact support to recover tokens.`);
    }
  } else {
    // Execute via FX Anchor SDK
    console.log('📋 FX Anchor raw quote:', anchorQuote.rawQuote);
    console.log('📋 Raw quote methods:', Object.keys(anchorQuote.rawQuote));

    try {
      // The rawQuote is the quoteWrapper from FX SDK
      // createExchange() initiates the atomic swap
      const exchange = await anchorQuote.rawQuote.createExchange();

      console.log('✅ FX Anchor exchange created:', exchange);
      console.log('   Exchange ID:', exchange?.exchange?.exchangeID);

      return {
        success: true,
        exchangeID: exchange?.exchange?.exchangeID || 'unknown',
      };
    } catch (fxError: any) {
      console.error('❌ FX Anchor createExchange failed:', fxError);
      throw new Error(`FX Anchor swap failed: ${fxError.message}`);
    }
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
