// server/keeta-impl/routes/fx.js
// Manual FX Anchor routes implementation (simpler than SDK adapter)
// Based on @keetanetwork/anchor FX server expected interface

import express from 'express';
import { getOpsClient, accountFromAddress } from '../utils/client.js';
import { getSilverbackAnchorService } from '../services/anchor-service.js';
import { KeetaNet } from '@keetanetwork/keetanet-client';
import * as Signing from '@keetanetwork/anchor/lib/utils/signing.js';

const router = express.Router();

/**
 * Homepage / Metadata endpoint
 * GET /
 */
router.get('/', (req, res) => {
  res.type('text/html');
  res.send('https://dexkeeta.onrender.com');
});

/**
 * Get swap quote with signature
 * POST /api/getQuote
 */
router.post('/api/getQuote', async (req, res) => {
  try {
    const { request: conversion } = req.body;

    if (!conversion) {
      return res.status(400).json({ error: 'Missing request in body' });
    }

    const anchorService = getSilverbackAnchorService();
    const opsClient = await getOpsClient();

    // Get quote from Silverback pools
    const tokenIn = conversion.from;
    const tokenOut = conversion.to;
    const amountIn = BigInt(conversion.amount);

    const quote = await anchorService.getQuote(tokenIn, tokenOut, amountIn, 9, 9);

    if (!quote) {
      return res.status(404).json({ error: 'No pool available for this conversion' });
    }

    const poolAccount = accountFromAddress(quote.poolAddress);
    const amountOut = BigInt(quote.amountOut);

    // Calculate protocol fee (0.05%)
    const protocolFee = (amountOut * anchorService.PROTOCOL_FEE_BPS) / 10000n;
    const amountToUser = amountOut - protocolFee;

    // Pool creator fee
    const poolCreatorFee = amountIn - (amountIn * (10000n - BigInt(quote.feeBps))) / 10000n;

    // Build unsigned quote
    const unsignedQuote = {
      request: conversion,
      account: poolAccount.publicKeyString.get(),
      convertedAmount: amountToUser.toString(),
      cost: {
        token: accountFromAddress(tokenIn).publicKeyString.get(),
        amount: poolCreatorFee.toString()
      }
    };

    // Sign quote
    const signableQuote = [
      unsignedQuote.request.from,
      unsignedQuote.request.to,
      unsignedQuote.request.amount,
      unsignedQuote.request.affinity,
      unsignedQuote.account,
      unsignedQuote.convertedAmount,
      unsignedQuote.cost.token,
      unsignedQuote.cost.amount
    ];

    const signed = await Signing.SignData(opsClient.account, signableQuote);

    const signedQuote = {
      ...unsignedQuote,
      signed
    };

    res.json({
      ok: true,
      quote: signedQuote
    });
  } catch (error) {
    console.error('❌ /api/getQuote error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get swap estimate (unsigned quote)
 * POST /api/getEstimate
 */
router.post('/api/getEstimate', async (req, res) => {
  try {
    const { request: conversion } = req.body;

    if (!conversion) {
      return res.status(400).json({ error: 'Missing request in body' });
    }

    const anchorService = getSilverbackAnchorService();

    // Get quote from Silverback pools
    const tokenIn = conversion.from;
    const tokenOut = conversion.to;
    const amountIn = BigInt(conversion.amount);

    const quote = await anchorService.getQuote(tokenIn, tokenOut, amountIn, 9, 9);

    if (!quote) {
      return res.status(404).json({ error: 'No pool available for this conversion' });
    }

    const amountOut = BigInt(quote.amountOut);
    const protocolFee = (amountOut * anchorService.PROTOCOL_FEE_BPS) / 10000n;
    const amountToUser = amountOut - protocolFee;
    const poolCreatorFee = amountIn - (amountIn * (10000n - BigInt(quote.feeBps))) / 10000n;

    res.json({
      ok: true,
      estimate: {
        request: conversion,
        convertedAmount: amountToUser.toString(),
        expectedCost: {
          min: poolCreatorFee.toString(),
          max: poolCreatorFee.toString(),
          token: accountFromAddress(tokenIn).publicKeyString.get()
        }
      }
    });
  } catch (error) {
    console.error('❌ /api/getEstimate error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Create and execute exchange
 * POST /api/createExchange
 */
router.post('/api/createExchange', async (req, res) => {
  try {
    const { request: exchangeRequest } = req.body;

    if (!exchangeRequest || !exchangeRequest.quote || !exchangeRequest.block) {
      return res.status(400).json({ error: 'Missing quote or block in request' });
    }

    const { quote, block: blockString } = exchangeRequest;
    const opsClient = await getOpsClient();
    const anchorService = getSilverbackAnchorService();

    // Verify quote signature
    const signableQuote = [
      quote.request.from,
      quote.request.to,
      quote.request.amount,
      quote.request.affinity,
      quote.account,
      quote.convertedAmount,
      quote.cost.token,
      quote.cost.amount
    ];

    const isValidQuote = await Signing.VerifySignedData(
      opsClient.account,
      signableQuote,
      quote.signed
    );

    if (!isValidQuote) {
      return res.status(400).json({ error: 'Invalid quote signature' });
    }

    // Create block and accept swap
    const block = new KeetaNet.lib.Block(blockString);
    const poolAccount = accountFromAddress(quote.account);

    // Create user client for pool account (OPS signs on behalf using SEND_ON_BEHALF)
    const userClient = new KeetaNet.UserClient({
      client: opsClient.client,
      network: opsClient.network,
      networkAlias: opsClient.networkAlias,
      account: poolAccount,
      signer: opsClient.account // OPS account signs
    });

    // Expected token and amount for swap
    const expectedToken = KeetaNet.lib.Account.fromPublicKeyString(quote.request.from);
    let expectedAmount = quote.request.affinity === 'from'
      ? BigInt(quote.request.amount)
      : BigInt(quote.convertedAmount);

    // Add cost if same token
    if (BigInt(quote.cost.amount) > 0) {
      const costToken = KeetaNet.lib.Account.fromPublicKeyString(quote.cost.token);
      if (expectedToken.comparePublicKey(costToken)) {
        expectedAmount += BigInt(quote.cost.amount);
      }
    }

    // Accept swap request and publish
    const swapBlocks = await userClient.acceptSwapRequest({
      block,
      expected: { token: expectedToken, amount: expectedAmount }
    });

    const publishResult = await userClient.client.transmit(swapBlocks, {});

    if (!publishResult.publish) {
      throw new Error('Exchange publish failed');
    }

    console.log(`✅ FX Swap executed: ${block.hash.toString()}`);

    res.json({
      ok: true,
      exchangeID: block.hash.toString()
    });
  } catch (error) {
    console.error('❌ /api/createExchange error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get exchange status
 * GET /api/getExchangeStatus/:id
 */
router.get('/api/getExchangeStatus/:id', async (req, res) => {
  try {
    const { id: exchangeID } = req.params;

    if (!exchangeID) {
      return res.status(400).json({ error: 'Missing exchange ID' });
    }

    const opsClient = await getOpsClient();
    const blockLookup = await opsClient.client.getVoteStaple(exchangeID);

    if (!blockLookup) {
      return res.status(404).json({ error: 'Exchange not found' });
    }

    res.json({
      ok: true,
      exchangeID
    });
  } catch (error) {
    console.error('❌ /api/getExchangeStatus error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Service metadata for resolver discovery
 * GET /.well-known/keeta-services
 */
router.get('/.well-known/keeta-services', async (req, res) => {
  try {
    const anchorService = getSilverbackAnchorService();
    const pools = await anchorService.getAvailablePools();

    // Build conversion pairs from pools
    const conversionMap = new Map();

    for (const pool of pools) {
      if (!conversionMap.has(pool.token_a)) {
        conversionMap.set(pool.token_a, new Set());
      }
      if (!conversionMap.has(pool.token_b)) {
        conversionMap.set(pool.token_b, new Set());
      }

      conversionMap.get(pool.token_a).add(pool.token_b);
      conversionMap.get(pool.token_b).add(pool.token_a);
    }

    const conversions = [];
    for (const [fromToken, toTokens] of conversionMap.entries()) {
      conversions.push({
        currencyCodes: [fromToken],
        to: Array.from(toTokens)
      });
    }

    res.json({
      services: {
        fx: {
          silverback: {
            from: conversions
          }
        }
      }
    });
  } catch (error) {
    console.error('❌ Metadata endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
