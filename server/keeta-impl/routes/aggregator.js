// server/keeta-impl/routes/aggregator.js
// FX Aggregator API routes - get best quotes across all providers

import express from 'express';
import { getFXAggregator } from '../services/fx-aggregator.js';

const router = express.Router();

/**
 * GET /api/aggregator/providers
 * List all known FX providers
 */
router.get('/providers', async (req, res) => {
  try {
    const aggregator = getFXAggregator();
    const providers = await aggregator.listProviders();

    res.json({
      ok: true,
      providers,
      count: providers.length
    });
  } catch (error) {
    console.error('Error listing providers:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * POST /api/aggregator/quote
 * Get quotes from all providers for a token pair
 *
 * Body:
 * {
 *   from: "keeta_xxx...",     // Input token address
 *   to: "keeta_yyy...",       // Output token address
 *   amount: "1000000000",     // Amount (as string)
 *   affinity: "from"          // "from" or "to" (optional, default: "from")
 * }
 */
router.post('/quote', async (req, res) => {
  try {
    const { from, to, amount, affinity = 'from' } = req.body;

    if (!from || !to || !amount) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required fields: from, to, amount'
      });
    }

    const aggregator = getFXAggregator();
    const result = await aggregator.getAllQuotes(from, to, amount, affinity);

    // Convert BigInt to strings for JSON serialization
    const quotes = result.quotes.map(q => ({
      ...q,
      convertedAmount: q.convertedAmount.toString(),
      score: q.score.toString()
    }));

    const bestQuote = result.bestQuote ? {
      ...result.bestQuote,
      convertedAmount: result.bestQuote.convertedAmount.toString(),
      score: result.bestQuote.score.toString()
    } : null;

    res.json({
      ok: true,
      bestQuote,
      allQuotes: quotes,
      providersQueried: result.providersQueried,
      request: { from, to, amount, affinity }
    });
  } catch (error) {
    console.error('Error getting aggregated quotes:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * POST /api/aggregator/best-quote
 * Get only the best quote (faster response)
 */
router.post('/best-quote', async (req, res) => {
  try {
    const { from, to, amount, affinity = 'from' } = req.body;

    if (!from || !to || !amount) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required fields: from, to, amount'
      });
    }

    const aggregator = getFXAggregator();
    const bestQuote = await aggregator.getBestQuote(from, to, amount, affinity);

    if (!bestQuote) {
      return res.json({
        ok: false,
        error: 'No quotes available for this pair'
      });
    }

    res.json({
      ok: true,
      quote: {
        ...bestQuote,
        convertedAmount: bestQuote.convertedAmount.toString(),
        score: bestQuote.score.toString()
      },
      request: { from, to, amount, affinity }
    });
  } catch (error) {
    console.error('Error getting best quote:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// NOTE: /add-provider endpoint removed for security
// Providers should be added via environment configuration

export default router;
