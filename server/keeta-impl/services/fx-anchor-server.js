// server/keeta-impl/services/fx-anchor-server.js
// FX Anchor SDK Server for Silverback Anchor Pools
// Enables Silverback pools to be discovered via FX resolver and creates proper SWAP transactions

import { FX } from '@keetanetwork/anchor';
import { getOpsClient, getTreasuryAccount, accountFromAddress } from '../utils/client.js';
import { getSilverbackAnchorService } from './anchor-service.js';

/**
 * Create and start FX Anchor HTTP Server for Silverback
 * This enables Silverback pools to be discovered via the FX resolver
 * and creates proper SWAP transactions instead of two SEND transactions
 */
export async function createSilverbackFXAnchorServer(port = 3001) {
  const opsClient = await getOpsClient();
  const anchorService = getSilverbackAnchorService();
  const treasuryAccount = getTreasuryAccount();

  console.log('🚀 Initializing Silverback FX Anchor Server...');

  const server = new FX.Server({
    // Server configuration
    port: port,

    // Homepage/metadata
    homepage: 'https://dexkeeta.onrender.com',

    // Network client for blockchain operations
    client: opsClient,

    // Pool accounts - function that returns the pool for a given conversion
    account: async (request) => {
      try {
        const tokenIn = request.from.publicKeyString.get();
        const tokenOut = request.to.publicKeyString.get();
        const amountIn = request.amount;

        // Get quote to find best pool
        const quote = await anchorService.getQuote(tokenIn, tokenOut, amountIn, 9, 9);

        if (!quote || !quote.poolAddress) {
          throw new Error('No Silverback pool available for this conversion pair');
        }

        // Return pool account
        return accountFromAddress(quote.poolAddress);
      } catch (error) {
        console.error('❌ Error getting pool account:', error);
        throw error;
      }
    },

    // Signer for the pool (OPS account signs on behalf of pools using SEND_ON_BEHALF)
    signer: opsClient.account,

    // Quote signer for signing quotes
    quoteSigner: opsClient.account,

    // FX conversion configuration
    fx: {
      /**
       * Supported conversion pairs
       * Returns list of token pairs that Silverback pools support
       */
      from: async () => {
        try {
          const pools = await anchorService.getAvailablePools();

          if (!pools || pools.length === 0) {
            console.log('⚠️ No Silverback pools available');
            return [];
          }

          console.log(`📊 Found ${pools.length} Silverback pools for FX resolver`);

          // Build unique conversion paths
          const conversionMap = new Map();

          for (const pool of pools) {
            // Add both directions for each pool
            const keyAB = pool.token_a;
            const keyBA = pool.token_b;

            if (!conversionMap.has(keyAB)) {
              conversionMap.set(keyAB, new Set());
            }
            if (!conversionMap.has(keyBA)) {
              conversionMap.set(keyBA, new Set());
            }

            conversionMap.get(keyAB).add(pool.token_b);
            conversionMap.get(keyBA).add(pool.token_a);
          }

          // Convert to FX SDK format
          const conversions = [];
          for (const [fromToken, toTokens] of conversionMap.entries()) {
            conversions.push({
              currencyCodes: [fromToken],
              to: Array.from(toTokens)
            });
          }

          return conversions;
        } catch (error) {
          console.error('❌ Error building conversion list:', error);
          return [];
        }
      },

      /**
       * Get conversion rate and fee for a quote
       * This is called by the FX SDK when clients request quotes
       */
      getConversionRateAndFee: async (request) => {
        try {
          const tokenIn = request.from.publicKeyString.get();
          const tokenOut = request.to.publicKeyString.get();
          const amountIn = request.amount;

          console.log(`📊 FX SDK Quote Request: ${Number(amountIn) / 1e9} tokens`);
          console.log(`   From: ${tokenIn.slice(0, 20)}...`);
          console.log(`   To: ${tokenOut.slice(0, 20)}...`);

          // Get quote from Silverback anchor service
          const quote = await anchorService.getQuote(tokenIn, tokenOut, amountIn, 9, 9);

          if (!quote) {
            throw new Error('No Silverback pools available for this conversion pair');
          }

          const poolAccount = accountFromAddress(quote.poolAddress);
          const amountOut = BigInt(quote.amountOut);

          // Calculate protocol fee (0.05%)
          const protocolFee = (amountOut * anchorService.PROTOCOL_FEE_BPS) / 10000n;
          const amountToUser = amountOut - protocolFee;

          // Pool creator's fee is already deducted in quote.amountOut
          const poolCreatorFee = amountIn - (amountIn * (10000n - BigInt(quote.feeBps))) / 10000n;

          // Total cost = pool creator fee (in tokenIn) + protocol fee (in tokenOut, converted to tokenIn)
          // For simplicity, we report pool creator fee as the cost
          const totalCost = poolCreatorFee;

          console.log(`✅ Quote: ${quote.amountInFormatted} → ${Number(amountToUser) / 1e9} (after 0.05% protocol fee)`);
          console.log(`   Pool: ${quote.poolAddress.slice(-12)}`);
          console.log(`   Creator Fee: ${quote.feeBps / 100}%`);
          console.log(`   Protocol Fee: 0.05%`);

          // Return quote in FX SDK format
          return {
            // Pool account
            account: poolAccount,

            // Amount user receives (after protocol fee)
            convertedAmount: amountToUser,

            // Cost (pool creator fee in input token)
            cost: {
              amount: totalCost,
              token: accountFromAddress(tokenIn)
            }
          };
        } catch (error) {
          console.error('❌ FX SDK quote error:', error);
          throw error;
        }
      },

      /**
       * Validate quote before executing exchange
       * Optional - can reject stale or invalid quotes
       */
      validateQuote: async (quote) => {
        try {
          // Accept all quotes for now
          // In production, could check:
          // - Quote timestamp/expiry
          // - Current pool reserves vs quote amounts
          // - Slippage tolerance
          return true;
        } catch (error) {
          console.error('❌ Quote validation error:', error);
          return false;
        }
      }
    }
  });

  console.log(`✅ Silverback FX Anchor Server initialized on port ${port}`);
  console.log(`   Provider ID: silverback`);
  console.log(`   Endpoint: http://localhost:${port}`);

  return server;
}

/**
 * Start the FX Anchor Server
 * Call this from main server startup
 */
export async function startSilverbackFXAnchorServer(port = 3001) {
  try {
    const server = await createSilverbackFXAnchorServer(port);
    await server.listen();
    console.log(`🎉 Silverback FX Anchor Server listening on port ${port}`);
    return server;
  } catch (error) {
    console.error('❌ Failed to start FX Anchor Server:', error);
    throw error;
  }
}
