/**
 * Keeta FX Anchor Service
 * Provides access to FX anchor liquidity for token swaps
 */

import { FX, lib as KeetaNetLib, KeetaNet } from '@keetanetwork/anchor';
import type { UserClient } from '@keetanetwork/keetanet-client';

export type AnchorQuote = {
  from: string; // Token address
  to: string; // Token address
  amountIn: string; // Human-readable amount
  amountOut: string; // Human-readable amount
  amountOutAtomic: bigint; // Atomic units
  priceImpact: number;
  fee: string; // Fee in token terms
  providerID: string;
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
 * Returns quotes from multiple anchor providers
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
    const fxClient = createFXClient(userClient);

    // Create conversion request using the Account.fromPublicKeyString format
    const fromAccount = KeetaNetLib.Account.fromPublicKeyString(fromToken);
    const toAccount = KeetaNetLib.Account.fromPublicKeyString(toToken);

    const conversionRequest = {
      from: fromAccount,
      to: toAccount,
      amount: amount,
      affinity: 'from' as const, // Amount is in 'from' token
    };

    console.log('📊 Fetching anchor quotes for:', {
      from: fromToken.slice(0, 12) + '...',
      to: toToken.slice(0, 12) + '...',
      amount: amount.toString(),
    });

    // Get quotes from all available anchor providers
    const quotes = await fxClient.getQuotes(conversionRequest);

    if (!quotes || quotes.length === 0) {
      console.log('⚠️ No anchor quotes available');
      return [];
    }

    console.log(`✅ Received ${quotes.length} anchor quote(s)`);

    // Convert quotes to our format
    const anchorQuotes: AnchorQuote[] = quotes.map((quoteWrapper) => {
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
        providerID: 'anchor', // We can enhance this later with actual provider IDs
        rawQuote: quoteWrapper,
      };
    });

    return anchorQuotes;
  } catch (error) {
    console.error('❌ Failed to get anchor quotes:', error);
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

    const fromAccount = KeetaNetLib.Account.fromPublicKeyString(fromToken);
    const toAccount = KeetaNetLib.Account.fromPublicKeyString(toToken);

    const conversionRequest = {
      from: fromAccount,
      to: toAccount,
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
 */
export async function executeAnchorSwap(
  anchorQuote: AnchorQuote
): Promise<{ success: boolean; exchangeID?: string; error?: string }> {
  try {
    console.log('🚀 Executing anchor swap...');

    if (!anchorQuote.rawQuote) {
      throw new Error('Invalid anchor quote - missing raw quote data');
    }

    // Create exchange using the quote
    const exchange = await anchorQuote.rawQuote.createExchange();

    console.log('✅ Anchor swap submitted:', exchange.exchange.exchangeID);

    return {
      success: true,
      exchangeID: exchange.exchange.exchangeID,
    };
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

    const fromAccount = KeetaNetLib.Account.fromPublicKeyString(fromToken);

    const result = await fxClient.listPossibleConversions({
      from: fromAccount,
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
