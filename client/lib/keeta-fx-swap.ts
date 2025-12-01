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
 */
export function createSilverbackFXClient(userClient: any): any {
  // Create resolver pointing to our Silverback resolver account
  const resolverConfig = {
    client: userClient,
    root: KeetaNet.lib.Account.fromPublicKeyString(SILVERBACK_RESOLVER),
    trustedCAs: [],
    network: NETWORK as 'test' | 'main',
  };

  const resolver = new Resolver(resolverConfig);

  // Create FX Client with our custom resolver
  return new FX.Client(userClient, {
    resolver,
    network: NETWORK as 'test' | 'main',
  });
}

/**
 * Get quotes from Silverback FX resolver
 * Returns atomic swap quotes that can be executed with a single transaction
 */
export async function getFXSwapQuotes(
  userClient: any,
  fromToken: string,
  toToken: string,
  amount: bigint,
  affinity: 'from' | 'to' = 'from'
): Promise<FXSwapQuote[]> {
  try {
    const fxClient = createSilverbackFXClient(userClient);

    const conversionRequest = {
      from: fromToken,
      to: toToken,
      amount: amount,
      affinity,
    };

    console.log('🔍 Fetching FX quotes from Silverback resolver...');
    const quotes = await fxClient.getQuotes(conversionRequest);

    if (!quotes || quotes.length === 0) {
      console.log('⚠️ No FX quotes available');
      return [];
    }

    console.log(`✅ Received ${quotes.length} FX quote(s)`);

    // Convert to our format
    const fxQuotes: FXSwapQuote[] = quotes.map((quoteWrapper: any) => {
      const quote = quoteWrapper.quote;
      return {
        from: fromToken,
        to: toToken,
        amountIn: amount,
        amountOut: quote.convertedAmount,
        cost: quote.cost.amount,
        costToken: quote.cost.token.publicKeyString.get(),
        providerID: quoteWrapper.provider?.providerID || 'silverback',
        account: quote.account.publicKeyString.get(),
        rawQuote: quoteWrapper,
      };
    });

    // Sort by best output (descending)
    fxQuotes.sort((a, b) => {
      if (b.amountOut > a.amountOut) return 1;
      if (b.amountOut < a.amountOut) return -1;
      return 0;
    });

    return fxQuotes;
  } catch (error: any) {
    console.error('❌ Failed to get FX quotes:', error);
    return [];
  }
}

/**
 * Execute atomic FX swap
 *
 * This creates an atomic SWAP transaction with both SEND and RECEIVE
 * instructions in a single block. The user signs once and the swap
 * executes atomically - either both transfers happen or neither does.
 */
export async function executeFXSwap(
  quote: FXSwapQuote
): Promise<FXSwapResult> {
  try {
    console.log('🚀 Executing atomic FX swap...');
    console.log(`   Pool: ${quote.account.slice(-12)}`);
    console.log(`   Amount: ${quote.amountIn.toString()} → ${quote.amountOut.toString()}`);

    // The rawQuote has createExchange method from SDK
    if (!quote.rawQuote?.createExchange) {
      throw new Error('Invalid quote - missing createExchange method');
    }

    // createExchange builds the atomic SWAP block and submits it
    // The SDK handles:
    // 1. Building the block with SEND + RECEIVE instructions
    // 2. User signs via Keythings
    // 3. Block is sent to FX server's createExchange endpoint
    // 4. Server completes the swap atomically
    const exchange = await quote.rawQuote.createExchange();

    console.log('✅ Atomic FX swap completed!');
    console.log(`   Exchange ID: ${exchange.exchange?.exchangeID || 'N/A'}`);

    return {
      success: true,
      exchangeID: exchange.exchange?.exchangeID,
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
