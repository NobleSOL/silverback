// server/keeta-impl/services/fx-anchor-server.js
// FX Anchor SDK Server for Silverback Anchor Pools
// Enables Silverback pools to be discovered via FX resolver and creates proper SWAP transactions

import { KeetaNetFXAnchorHTTPServer } from '@keetanetwork/anchor/services/fx/server.js';
import { getOpsClient, getTreasuryAccount, accountFromAddress, getOpsAccount } from '../utils/client.js';
import { getSilverbackAnchorService } from './anchor-service.js';
import { getAnchorRepository } from '../db/anchor-repository.js';
import * as KeetaNet from '@keetanetwork/keetanet-client';

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

  // IMPORTANT: Pass underlying Client, NOT UserClient!
  // The SDK checks if config.client is a UserClient:
  // - If UserClient: uses it directly, ignores account/signer config
  // - If Client: creates per-request UserClient with pool account + signer
  const server = new KeetaNetFXAnchorHTTPServer({
    // Server configuration
    port: port,

    // Homepage/metadata
    homepage: 'https://dexkeeta.onrender.com',

    // Network client for blockchain operations (NOT UserClient!)
    client: {
      client: opsClient.client,
      network: opsClient.network,
      networkAlias: 'main'
    },

    // Pool accounts - function that returns the pool for a given conversion
    account: async (request) => {
      try {
        console.log('🔍 FX SDK account() request:', {
          from: request.from,
          fromType: typeof request.from,
          to: request.to,
          toType: typeof request.to,
          amount: request.amount
        });

        // request.from and request.to are already string addresses
        const tokenIn = request.from;
        const tokenOut = request.to;
        // SDK passes amount as string, anchor-service expects BigInt
        const amountIn = BigInt(request.amount);

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
          console.log('🔍 FX SDK getConversionRateAndFee() request:', {
            from: request.from,
            fromType: typeof request.from,
            to: request.to,
            toType: typeof request.to,
            amount: request.amount
          });

          // request.from and request.to are already string addresses
          const tokenIn = request.from;
          const tokenOut = request.to;
          // SDK passes amount as string, anchor-service expects BigInt
          const amountIn = BigInt(request.amount);

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
 * Start the FX Anchor Server (standalone on separate port)
 * Use this for local testing only
 */
export async function startSilverbackFXAnchorServer(port = 3001) {
  try {
    const server = await createSilverbackFXAnchorServer(port);
    await server.start();
    console.log(`🎉 Silverback FX Anchor Server listening on port ${port}`);
    return server;
  } catch (error) {
    console.error('❌ Failed to start FX Anchor Server:', error);
    throw error;
  }
}

/**
 * Get FX Anchor routes to mount in existing Express app
 * Use this for production (single port deployment)
 */
export async function getSilverbackFXAnchorRoutes() {
  try {
    console.log('🔗 Initializing Silverback FX Anchor routes...');

    const opsClient = await getOpsClient();
    const anchorService = getSilverbackAnchorService();
    const treasuryAccount = getTreasuryAccount();

    // Build config for FX server
    // IMPORTANT: Pass underlying Client, NOT UserClient!
    // The SDK checks if config.client is a UserClient:
    // - If UserClient: uses it directly, ignores account/signer config
    // - If Client: creates per-request UserClient with pool account + signer
    // We need the second behavior so swaps use the correct pool account
    const config = {
      // No port - we're getting routes only
      homepage: 'https://dexkeeta.onrender.com',
      client: {
        client: opsClient.client,
        network: opsClient.network,
        networkAlias: 'main'
      },
      account: async (request) => {
        try {
          // request.from and request.to are already string addresses
          const tokenIn = request.from;
          const tokenOut = request.to;
          // SDK passes amount as string, anchor-service expects BigInt
          const amountIn = BigInt(request.amount);

          const quote = await anchorService.getQuote(tokenIn, tokenOut, amountIn, 9, 9);

          if (!quote || !quote.poolAddress) {
            throw new Error('No Silverback pool available for this conversion pair');
          }

          return accountFromAddress(quote.poolAddress);
        } catch (error) {
          console.error('❌ Error getting pool account:', error);
          throw error;
        }
      },
      signer: opsClient.account,
      quoteSigner: opsClient.account,
      fx: {
        from: async () => {
          try {
            const pools = await anchorService.getAvailablePools();

            if (!pools || pools.length === 0) {
              console.log('⚠️ No Silverback pools available');
              return [];
            }

            console.log(`📊 Found ${pools.length} Silverback pools for FX resolver`);

            const conversionMap = new Map();

            for (const pool of pools) {
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
        getConversionRateAndFee: async (request) => {
          try {
            // request.from and request.to are already string addresses
            const tokenIn = request.from;
            const tokenOut = request.to;
            // SDK passes amount as string, anchor-service expects BigInt
            const amountIn = BigInt(request.amount);

            const quote = await anchorService.getQuote(tokenIn, tokenOut, amountIn, 9, 9);

            if (!quote) {
              throw new Error('No Silverback pools available for this conversion pair');
            }

            const poolAccount = accountFromAddress(quote.poolAddress);
            const amountOut = BigInt(quote.amountOut);

            const protocolFee = (amountOut * anchorService.PROTOCOL_FEE_BPS) / 10000n;
            const amountToUser = amountOut - protocolFee;

            const poolCreatorFee = amountIn - (amountIn * (10000n - BigInt(quote.feeBps))) / 10000n;
            const totalCost = poolCreatorFee;

            return {
              account: poolAccount,
              convertedAmount: amountToUser,
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
        validateQuote: async (quote) => {
          return true;
        }
      }
    };

    // Create server instance
    const { KeetaNetFXAnchorHTTPServer } = await import('@keetanetwork/anchor/services/fx/server.js');
    const server = new KeetaNetFXAnchorHTTPServer(config);

    // Get routes from SDK (returns object, not Express router)
    console.log('🔍 Calling server.initRoutes()...');
    const routes = await server.initRoutes(config);

    console.log('🔍 Routes returned from SDK:', {
      type: typeof routes,
      isArray: Array.isArray(routes),
      keys: routes ? Object.keys(routes) : 'null',
      routeCount: routes ? Object.keys(routes).length : 0
    });

    // Convert SDK routes to Express router
    const express = await import('express');
    const router = express.Router();

    // Store reference to SDK's createExchange handler for our wrapper
    let sdkCreateExchangeHandler = null;

    // Iterate over routes and add to Express (EXCEPT createExchange which we override)
    let registeredCount = 0;
    for (const [routePattern, handler] of Object.entries(routes)) {
      try {
        const [method, path] = routePattern.split(' ');
        const lowerMethod = method.toLowerCase();

        // Store createExchange handler but don't add to router - we'll wrap it
        if (path === '/api/createExchange') {
          sdkCreateExchangeHandler = typeof handler === 'function' ? handler : handler.handler;
          console.log(`🔗 Captured SDK route: ${method} ${path} (will wrap with treasury fee handler)`);
          continue;
        }

        console.log(`🔗 Registering FX route: ${method} ${path}`);

        // Create Express-compatible handler
        const expressHandler = async (req, res) => {
          try {
            console.log(`🔍 FX Request to ${routePattern}:`, {
              body: req.body,
              params: req.params,
              query: req.query
            });

            // Convert Express request to SDK format
            const urlParams = new Map(Object.entries(req.params));
            // SDK expects { request: {...} } format, not raw body
            const postData = req.body?.request ? req.body : { request: req.body };
            const requestHeaders = req.headers;
            const requestUrl = new URL(req.originalUrl, `http://${req.headers.host}`);

            // Call SDK handler
            const handlerFn = typeof handler === 'function' ? handler : handler.handler;
            const result = await handlerFn(urlParams, postData, requestHeaders, requestUrl);

            // Send response
            if (result.statusCode) {
              res.status(result.statusCode);
            }
            if (result.headers) {
              for (const [key, value] of Object.entries(result.headers)) {
                res.setHeader(key, value);
              }
            }
            res.type(result.contentType || 'application/json');
            res.send(result.output);
          } catch (error) {
            console.error(`❌ FX route error (${routePattern}):`, error);
            res.status(500).json({ error: error.message });
          }
        };

        // Add route to Express router
        router[lowerMethod](path, expressHandler);
        registeredCount++;
      } catch (error) {
        console.error(`❌ Failed to register route ${routePattern}:`, error);
      }
    }

    // Add custom createExchange handler that wraps SDK and adds treasury fee transfer
    // The SDK handles the main swap, then we transfer protocol fee from pool to treasury
    router.post('/api/createExchange', async (req, res) => {
      try {
        console.log('🔍 Custom createExchange with treasury fee:', req.body);

        const request = req.body?.request || req.body;
        if (!request || !request.quote) {
          return res.status(400).json({ ok: false, error: 'Missing quote in request' });
        }
        if (!request.block) {
          return res.status(400).json({ ok: false, error: 'Missing block in request' });
        }

        const quote = request.quote;

        // Extract quote details for treasury fee calculation
        const tokenIn = quote.request.from;
        const tokenOut = quote.request.to;
        const poolAddress = quote.account;
        const amountIn = BigInt(quote.request.amount);
        const amountToUser = BigInt(quote.convertedAmount);

        // Calculate protocol fee: 0.05% of the output amount
        // Note: getConversionRateAndFee already deducts this from convertedAmount
        // So protocolFee = fullOutput - convertedAmount
        // We can recalculate: protocolFee = convertedAmount * 5 / 9995 (approximately)
        // OR get fresh quote to know the full amount
        const freshQuote = await anchorService.getQuote(tokenIn, tokenOut, amountIn, 9, 9);
        if (!freshQuote) {
          return res.status(400).json({ ok: false, error: 'Pool no longer available' });
        }

        const fullAmountOut = BigInt(freshQuote.amountOut);
        const protocolFee = (fullAmountOut * anchorService.PROTOCOL_FEE_BPS) / 10000n;

        console.log(`💰 Exchange details:`);
        console.log(`   Pool: ${poolAddress}`);
        console.log(`   Input: ${Number(amountIn) / 1e9}`);
        console.log(`   Full Output: ${Number(fullAmountOut) / 1e9}`);
        console.log(`   User Gets: ${Number(amountToUser) / 1e9}`);
        console.log(`   Protocol Fee: ${Number(protocolFee) / 1e9} (0.05%) -> Treasury`);

        // Call the SDK's createExchange handler (captured earlier)
        if (!sdkCreateExchangeHandler) {
          return res.status(500).json({ ok: false, error: 'SDK createExchange handler not found' });
        }

        // Execute SDK handler
        const urlParams = new Map();
        const postData = { request };
        try {
          const sdkResult = await sdkCreateExchangeHandler(urlParams, postData, req.headers, new URL(req.originalUrl, `http://${req.headers.host}`));

          // Parse SDK result
          const sdkResponse = JSON.parse(sdkResult.output);
          if (!sdkResponse.ok) {
            return res.status(400).json(sdkResponse);
          }

          console.log(`✅ SDK swap completed: ${sdkResponse.exchangeID}`);

          // Now transfer protocol fee from pool to treasury (async, don't block response)
          if (protocolFee > 0n) {
            // Run treasury transfer in background
            (async () => {
              try {
                const poolAccount = accountFromAddress(poolAddress);
                const tokenOutAccount = accountFromAddress(tokenOut);
                const treasuryAccount = getTreasuryAccount();

                // Create pool's UserClient
                const poolUserClient = new KeetaNet.UserClient({
                  client: opsClient.client,
                  network: opsClient.network,
                  networkAlias: 'main',
                  account: poolAccount,
                  signer: opsClient.account
                });

                // Wait for swap to settle
                await new Promise(resolve => setTimeout(resolve, 2000));

                // Transfer protocol fee to treasury
                const builder = poolUserClient.initBuilder();
                builder.send(
                  treasuryAccount,
                  protocolFee,
                  tokenOutAccount,
                  undefined,
                  { account: poolAccount }
                );

                await poolUserClient.publishBuilder(builder);
                console.log(`✅ Treasury fee transferred: ${Number(protocolFee) / 1e9} to ${treasuryAccount.publicKeyString.get().slice(0, 20)}...`);

                // Record swap in database
                const repository = getAnchorRepository();
                const userBlock = new KeetaNet.lib.Block(request.block);
                const userAddress = userBlock.account.publicKeyString.get();

                await repository.recordAnchorSwap({
                  poolAddress,
                  tokenIn,
                  tokenOut,
                  amountIn,
                  amountOut: fullAmountOut,
                  feeCollected: amountIn - (amountIn * (10000n - BigInt(freshQuote.feeBps))) / 10000n,
                  protocolFee,
                  userAddress
                });
              } catch (err) {
                console.error(`❌ Treasury fee transfer failed:`, err.message);
                // Log for manual reconciliation
                console.error(`   MANUAL FIX NEEDED: Pool ${poolAddress.slice(-12)}, Fee ${Number(protocolFee) / 1e9}`);
              }
            })();
          }

          // Return success immediately (treasury transfer happens async)
          res.json(sdkResponse);
        } catch (sdkError) {
          console.error(`❌ SDK createExchange error:`, sdkError);
          return res.status(500).json({ ok: false, error: sdkError.message });
        }
      } catch (error) {
        console.error(`❌ Custom createExchange error:`, error);
        res.status(500).json({ ok: false, error: error.message });
      }
    });
    registeredCount++;

    console.log(`✅ Silverback FX Anchor routes initialized (${registeredCount} routes registered)`);
    console.log('   Provider ID: silverback');
    console.log('   Endpoints: /, /api/getQuote, /api/createExchange, /api/getExchangeStatus');

    return router;
  } catch (error) {
    console.error('❌ Failed to initialize FX Anchor routes:', error);
    throw error;
  }
}
