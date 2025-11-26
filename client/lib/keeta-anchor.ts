/**
 * Keeta FX Anchor Service
 * Provides access to FX anchor liquidity for token swaps
 */

import { FX } from '@keetanetwork/anchor';
import * as KeetaNet from '@keetanetwork/keetanet-client';
import type { UserClient } from '@keetanetwork/keetanet-client';

// Use KeetaNet.lib for Account utilities
const KeetaNetLib = KeetaNet.lib;

// API base URL - use environment variable or default to current origin
const API_BASE = import.meta.env.VITE_KEETA_API_BASE || `${window.location.origin}/api`;

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
 * Initialize FX Anchor client
 */
export function createFXClient(userClient: any, config?: any): any {
  return new FX.Client(userClient, config);
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
      const fxClient = createFXClient(userClient);

      // FX SDK expects token addresses as strings, not Account objects
      const conversionRequest = {
        from: fromToken,
        to: toToken,
        amount: amount,
        affinity: 'from' as const, // Amount is in 'from' token
      };

      const quotes = await fxClient.getQuotes(conversionRequest);

      if (quotes && quotes.length > 0) {
        console.log(`✅ Received ${quotes.length} FX Anchor quote(s)`);

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
 */
export async function executeAnchorSwap(
  anchorQuote: AnchorQuote,
  userClient?: any,
  userAddress?: string
): Promise<{ success: boolean; exchangeID?: string; error?: string }> {
  try {
    console.log(`🚀 Executing ${anchorQuote.providerID} swap...`);

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

      console.log('📝 TX1: Sending tokens to pool...');

      // TX1: User sends tokenIn to pool
      const poolAccount = KeetaNetLib.Account.fromPublicKeyString(quote.poolAddress);
      const tokenInAccount = KeetaNetLib.Account.fromPublicKeyString(quote.tokenIn);

      const tx1Builder = userClient.initBuilder();
      tx1Builder.send(poolAccount, BigInt(quote.amountIn), tokenInAccount);
      await userClient.publishBuilder(tx1Builder);

      console.log('✅ TX1 completed, waiting for finalization...');

      // Wait for finalization
      await new Promise(resolve => setTimeout(resolve, 2000));

      console.log('📝 TX2: Requesting backend to send tokens from pool...');

      // TX2: Call backend to complete the swap
      const response = await fetch(`${API_BASE}/anchor/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quote,
          userAddress,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Silverback swap TX2 failed');
      }

      console.log('✅ Silverback swap completed');

      return {
        success: true,
        exchangeID: data.poolAddress, // Use pool address as identifier
      };
    } else {
      // Execute via FX Anchor SDK
      const exchange = await anchorQuote.rawQuote.createExchange();

      console.log('✅ FX Anchor swap submitted:', exchange.exchange.exchangeID);

      return {
        success: true,
        exchangeID: exchange.exchange.exchangeID,
      };
    }
  } catch (error: any) {
    console.error('❌ Anchor swap failed:', error);
    return {
      success: false,
      error: error.message || 'Failed to execute anchor swap',
    };
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
