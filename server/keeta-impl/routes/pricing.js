// Pricing API for Keeta tokens
import express from 'express';
import { getPoolManager } from '../contracts/PoolManager.js';

const router = express.Router();

// KTA token address
const KTA_ADDRESS = 'keeta_anyiff4v34alvumupagmdyosydeq24lc4def5mrpmmyhx3j6vj2uucckeqn52';

/**
 * GET /api/pricing/tokens
 * Get USD prices for Keeta tokens
 *
 * Query params:
 *   - addresses: comma-separated list of token addresses
 *
 * Returns: { [address]: { priceUsd: number | null, change24h: number | null } }
 */
router.get('/tokens', async (req, res) => {
  try {
    const { addresses } = req.query;

    if (!addresses) {
      return res.status(400).json({
        success: false,
        error: 'Missing addresses parameter',
      });
    }

    const addressList = addresses.split(',').map(a => a.trim()).filter(Boolean);

    if (addressList.length === 0) {
      return res.json({ success: true, prices: {} });
    }

    const prices = await calculateTokenPrices(addressList);

    res.json({
      success: true,
      prices,
    });
  } catch (error) {
    console.error('Pricing error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Cache KTA price to reduce API calls and improve reliability
let cachedKTAPrice = null;
let cacheTimestamp = 0;
const CACHE_DURATION_MS = 60000; // 1 minute cache

/**
 * Fetch KTA price from CoinGecko API
 * Falls back to cached or default price if API fails
 */
async function fetchKTAPrice() {
  // Return cached price if still valid
  const now = Date.now();
  if (cachedKTAPrice && (now - cacheTimestamp < CACHE_DURATION_MS)) {
    return cachedKTAPrice;
  }

  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=keeta&vs_currencies=usd',
      {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000), // Increased to 10 second timeout
      }
    );

    if (response.ok) {
      const data = await response.json();
      const price = data?.keeta?.usd;
      if (typeof price === 'number' && price > 0) {
        // Update cache
        cachedKTAPrice = price;
        cacheTimestamp = now;
        console.log(`✅ Fetched KTA price from CoinGecko: $${price}`);
        return price;
      }
    }
  } catch (error) {
    console.warn('⚠️ Failed to fetch KTA price from CoinGecko:', error.message);
  }

  // If we have a cached price (even if expired), use it instead of fallback
  if (cachedKTAPrice) {
    console.log(`ℹ️ Using cached KTA price: $${cachedKTAPrice}`);
    return cachedKTAPrice;
  }

  // Last resort fallback
  console.warn('⚠️ Using fallback KTA price: $0.15');
  return 0.15;
}

/**
 * Calculate prices for a list of token addresses
 * KTA price is fetched live from CoinGecko
 * Other token prices are calculated based on pool ratios with KTA
 *
 * @param {string[]} addresses - Array of token addresses
 * @returns {Promise<Object>} - Map of address to {priceUsd, change24h}
 */
export async function calculateTokenPrices(addresses) {
  const prices = {};

  // Get KTA price from CoinGecko (with fallback)
  const ktaPrice = await fetchKTAPrice();

  const poolManager = await getPoolManager();
  const pools = poolManager.getAllPools();

  for (const address of addresses) {
    if (address === KTA_ADDRESS) {
      // KTA has a known price
      prices[address] = {
        priceUsd: ktaPrice,
        change24h: null, // TODO: Calculate from historical data when available
      };
    } else {
      // Find a pool with this token and KTA
      const pool = pools.find(p =>
        (p.tokenA === address && p.tokenB === KTA_ADDRESS) ||
        (p.tokenB === address && p.tokenA === KTA_ADDRESS)
      );

      if (pool) {
        // Calculate price based on pool ratio
        const isTokenA = pool.tokenA === address;
        const reserveToken = isTokenA ? BigInt(pool.reserveA) : BigInt(pool.reserveB);
        const reserveKTA = isTokenA ? BigInt(pool.reserveB) : BigInt(pool.reserveA);

        if (reserveToken > 0n && reserveKTA > 0n) {
          // Price of token = (reserveKTA / reserveToken) * ktaPrice
          // Using 9 decimals for both tokens
          const ratio = Number(reserveKTA) / Number(reserveToken);
          const tokenPrice = ratio * ktaPrice;

          prices[address] = {
            priceUsd: tokenPrice,
            change24h: null, // TODO: Calculate from snapshots
          };
        } else {
          prices[address] = {
            priceUsd: null,
            change24h: null,
          };
        }
      } else {
        // No pool found with KTA, can't calculate price
        prices[address] = {
          priceUsd: null,
          change24h: null,
        };
      }
    }
  }

  return prices;
}

export default router;
