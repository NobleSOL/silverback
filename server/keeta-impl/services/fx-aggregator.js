// server/keeta-impl/services/fx-aggregator.js
// FX Aggregator - Discovers ALL FX providers on Keeta and returns best rates
// This makes Silverback THE router for all Keeta FX swaps

import Resolver from '@keetanetwork/anchor/lib/resolver.js';
import * as KeetaNet from '@keetanetwork/keetanet-client';
import { getOpsClient } from '../utils/client.js';

// Known FX providers - manually configured until we get Keeta's root resolver
// Add any FX providers you discover here
const KNOWN_FX_PROVIDERS = [
  {
    id: 'silverback',
    name: 'Silverback DEX',
    baseUrl: process.env.FX_ANCHOR_URL || 'https://dexkeeta.onrender.com/fx',
    getQuoteUrl: null,  // Will be set in init
    createExchangeUrl: null,
    getExchangeStatusUrl: null,
    // Supported pairs - will be fetched dynamically
    pairs: []
  },
  // Add more providers here as you discover them:
  // {
  //   id: 'provider-name',
  //   name: 'Provider Display Name',
  //   baseUrl: 'https://provider-url.com/fx',
  //   pairs: [{ from: 'keeta_xxx...', to: 'keeta_yyy...' }]
  // }
];

// TODO: Get official Keeta root resolver account(s) for automatic discovery
// This is the master account that indexes all registered FX providers
const KEETA_ROOT_RESOLVERS = [
  // Example: 'keeta_a...' - Keeta's official root resolver
  // Your own resolver for backup: 'keeta_asnqu5qxwxq2rhuh77s3iciwhtvra2n7zxviva2ukwqbbxkwxtlqhle5cgcjm'
];

/**
 * FX Aggregator Service
 * Discovers all FX providers on Keeta network and aggregates quotes
 */
export class FXAggregatorService {
  constructor() {
    this.resolver = null;
    this.knownProviders = [...KNOWN_FX_PROVIDERS];
    this.discoveredProviders = [];
    this.initialized = false;
    this.cacheExpiry = 5 * 60 * 1000; // 5 minute cache
    this.providerCache = new Map();
    this.lastCacheUpdate = 0;
  }

  /**
   * Initialize the aggregator with known providers and resolver
   */
  async init() {
    if (this.initialized) return;

    console.log('🔧 Initializing FX Aggregator...');

    // Initialize known providers with full URLs
    for (const provider of this.knownProviders) {
      if (!provider.getQuoteUrl) {
        provider.getQuoteUrl = `${provider.baseUrl}/api/getQuote`;
        provider.createExchangeUrl = `${provider.baseUrl}/api/createExchange`;
        provider.getExchangeStatusUrl = `${provider.baseUrl}/api/getExchangeStatus/{id}`;
      }
    }
    console.log(`   Loaded ${this.knownProviders.length} known provider(s)`);

    // Initialize resolver for automatic discovery (if root resolvers configured)
    if (KEETA_ROOT_RESOLVERS.length > 0) {
      try {
        const opsClient = await getOpsClient();

        const rootAccounts = KEETA_ROOT_RESOLVERS.map(addr =>
          KeetaNet.lib.Account.fromPublicKeyString(addr)
        );

        this.resolver = new Resolver({
          root: rootAccounts,
          client: opsClient.client,
          trustedCAs: [],
          id: 'silverback-fx-aggregator'
        });

        console.log(`   Resolver initialized with ${rootAccounts.length} root account(s)`);
      } catch (error) {
        console.warn('   ⚠️ Failed to initialize resolver:', error.message);
      }
    } else {
      console.log('   ⚠️ No root resolvers configured - using known providers only');
    }

    this.initialized = true;
    console.log('✅ FX Aggregator ready');
  }

  /**
   * Add a provider manually (for runtime discovery)
   */
  addProvider(provider) {
    const existing = this.knownProviders.find(p => p.id === provider.id);
    if (!existing) {
      if (!provider.getQuoteUrl && provider.baseUrl) {
        provider.getQuoteUrl = `${provider.baseUrl}/api/getQuote`;
        provider.createExchangeUrl = `${provider.baseUrl}/api/createExchange`;
        provider.getExchangeStatusUrl = `${provider.baseUrl}/api/getExchangeStatus/{id}`;
      }
      this.knownProviders.push(provider);
      console.log(`✅ Added FX provider: ${provider.id}`);
    }
  }

  /**
   * Discover all FX providers that support a token pair
   * Combines known providers + resolver-discovered providers
   * @param {string} tokenIn - Input token address
   * @param {string} tokenOut - Output token address
   * @returns {Promise<Array>} List of FX providers with their endpoints
   */
  async discoverProviders(tokenIn, tokenOut) {
    await this.init();

    const providers = [];

    // Add known providers (they all support all pairs via their quote API)
    for (const provider of this.knownProviders) {
      providers.push({
        id: provider.id,
        name: provider.name || provider.id,
        getQuoteUrl: provider.getQuoteUrl,
        createExchangeUrl: provider.createExchangeUrl,
        getExchangeStatusUrl: provider.getExchangeStatusUrl,
        source: 'manual'
      });
    }

    // Try resolver-based discovery if available
    if (this.resolver) {
      try {
        const resolverProviders = await this.resolver.lookup('fx', {
          inputCurrencyCode: tokenIn,
          outputCurrencyCode: tokenOut
        });

        if (resolverProviders) {
          for (const [providerId, providerData] of Object.entries(resolverProviders)) {
            // Skip if we already have this provider
            if (providers.find(p => p.id === providerId)) continue;

            try {
              const operations = await providerData.operations?.('object');
              if (operations?.getQuote) {
                providers.push({
                  id: providerId,
                  name: providerId,
                  getQuoteUrl: operations.getQuote,
                  createExchangeUrl: operations.createExchange,
                  getExchangeStatusUrl: operations.getExchangeStatus,
                  source: 'resolver'
                });
              }
            } catch (err) {
              console.warn(`Failed to get operations for ${providerId}:`, err.message);
            }
          }
        }
      } catch (error) {
        console.warn('Resolver lookup failed:', error.message);
      }
    }

    console.log(`🔍 Found ${providers.length} FX provider(s) for ${tokenIn.slice(-8)} → ${tokenOut.slice(-8)}`);
    return providers;
  }

  /**
   * Get quotes from ALL providers and return sorted by best rate
   * @param {string} tokenIn - Input token address
   * @param {string} tokenOut - Output token address
   * @param {string} amount - Amount to swap (as string)
   * @param {string} affinity - 'from' or 'to'
   * @returns {Promise<Object>} All quotes sorted by best output
   */
  async getAllQuotes(tokenIn, tokenOut, amount, affinity = 'from') {
    // Discover all providers for this pair
    const providers = await this.discoverProviders(tokenIn, tokenOut);

    if (providers.length === 0) {
      return { quotes: [], providersQueried: 0 };
    }

    console.log(`📊 Fetching quotes from ${providers.length} provider(s)...`);

    // Query each provider in parallel
    const quotePromises = providers.map(async (provider) => {
      try {
        if (!provider.getQuoteUrl) {
          return null;
        }

        const startTime = Date.now();
        const response = await fetch(provider.getQuoteUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            request: {
              from: tokenIn,
              to: tokenOut,
              amount: amount,
              affinity: affinity
            }
          })
        });

        const latency = Date.now() - startTime;

        if (!response.ok) {
          console.warn(`Provider ${provider.id} returned ${response.status}`);
          return null;
        }

        const data = await response.json();
        if (!data.ok || !data.quote) {
          return null;
        }

        // Parse converted amount (handles hex)
        let convertedAmount = data.quote.convertedAmount;
        if (typeof convertedAmount === 'string' && convertedAmount.startsWith('0x')) {
          convertedAmount = BigInt(convertedAmount);
        } else {
          convertedAmount = BigInt(convertedAmount);
        }

        return {
          provider: provider.id,
          providerName: provider.name,
          providerEndpoints: {
            getQuote: provider.getQuoteUrl,
            createExchange: provider.createExchangeUrl,
            getExchangeStatus: provider.getExchangeStatusUrl
          },
          quote: data.quote,
          convertedAmount: convertedAmount,
          convertedAmountStr: convertedAmount.toString(),
          latencyMs: latency,
          source: provider.source,
          // For comparison - higher is better for output amount
          score: convertedAmount
        };
      } catch (error) {
        console.warn(`Failed to get quote from ${provider.id}:`, error.message);
        return null;
      }
    });

    const quotes = await Promise.all(quotePromises);
    const validQuotes = quotes.filter(q => q !== null);

    // Sort by best output (highest converted amount)
    validQuotes.sort((a, b) => {
      if (b.score > a.score) return 1;
      if (b.score < a.score) return -1;
      return 0;
    });

    console.log(`✅ Got ${validQuotes.length} valid quote(s) from ${providers.length} provider(s)`);

    return {
      quotes: validQuotes,
      bestQuote: validQuotes[0] || null,
      providersQueried: providers.length,
      tokenIn,
      tokenOut,
      amount,
      affinity
    };
  }

  /**
   * Get the single best quote across all providers
   * @param {string} tokenIn - Input token address
   * @param {string} tokenOut - Output token address
   * @param {string} amount - Amount to swap (as string)
   * @param {string} affinity - 'from' or 'to'
   * @returns {Promise<Object|null>} Best quote or null
   */
  async getBestQuote(tokenIn, tokenOut, amount, affinity = 'from') {
    const result = await this.getAllQuotes(tokenIn, tokenOut, amount, affinity);
    return result.bestQuote;
  }

  /**
   * List all known FX providers
   */
  async listProviders() {
    await this.init();

    const providers = this.knownProviders.map(p => ({
      id: p.id,
      name: p.name || p.id,
      baseUrl: p.baseUrl,
      source: 'manual'
    }));

    // Try to add resolver-discovered providers
    if (this.resolver) {
      try {
        const rootMeta = await this.resolver.getRootMetadata();
        const fxServices = await rootMeta.services?.fx?.('object');

        if (fxServices) {
          for (const providerId of Object.keys(fxServices)) {
            if (!providers.find(p => p.id === providerId)) {
              providers.push({
                id: providerId,
                name: providerId,
                source: 'resolver'
              });
            }
          }
        }
      } catch (error) {
        // Resolver discovery failed, use known providers only
      }
    }

    return providers;
  }

  /**
   * Execute a swap through a specific provider
   * @param {string} providerId - Provider to use (or 'best' for best quote)
   * @param {Object} params - Swap parameters
   */
  async executeSwap(providerId, params) {
    await this.init();

    let provider;

    if (providerId === 'best') {
      // Get best quote and use that provider
      const result = await this.getAllQuotes(
        params.from,
        params.to,
        params.amount,
        params.affinity
      );
      if (!result.bestQuote) {
        throw new Error('No quotes available');
      }
      return {
        useProvider: result.bestQuote.provider,
        createExchangeUrl: result.bestQuote.providerEndpoints.createExchange,
        quote: result.bestQuote.quote
      };
    }

    // Find specific provider
    provider = this.knownProviders.find(p => p.id === providerId);
    if (!provider) {
      throw new Error(`Provider ${providerId} not found`);
    }

    return {
      useProvider: provider.id,
      createExchangeUrl: provider.createExchangeUrl,
      getQuoteUrl: provider.getQuoteUrl
    };
  }
}

// Singleton instance
let aggregatorInstance = null;

export function getFXAggregator() {
  if (!aggregatorInstance) {
    aggregatorInstance = new FXAggregatorService();
  }
  return aggregatorInstance;
}

/**
 * Example usage:
 *
 * const aggregator = getFXAggregator();
 *
 * // Get ALL quotes sorted by best rate
 * const result = await aggregator.getAllQuotes(
 *   'keeta_anyiff...', // KTA
 *   'keeta_ant6bs...', // WAVE
 *   '1000000000',      // 1 token
 *   'from'
 * );
 *
 * console.log('All quotes:', result.quotes);
 * console.log('Best provider:', result.bestQuote?.provider);
 * console.log('Best output:', result.bestQuote?.convertedAmount);
 *
 * // Or just get the best quote
 * const best = await aggregator.getBestQuote(tokenIn, tokenOut, amount);
 */
