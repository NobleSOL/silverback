/**
 * Simple USD pricing utility using CoinGecko's free API
 * This is optional enhancement and won't break DEX functionality if it fails
 */

const COINGECKO_API = "https://api.coingecko.com/api/v3";

// Map token symbols to CoinGecko IDs
const TOKEN_TO_COINGECKO_ID: Record<string, string> = {
  ETH: "ethereum",
  WETH: "ethereum",
  USDC: "usd-coin",
  WBTC: "wrapped-bitcoin",
  AERO: "aerodrome-finance",
  DEGEN: "degen-base",
  KTA: "keeta", // May need to verify this ID
};

// Cache prices for 1 minute to avoid rate limiting
const priceCache: Record<string, { price: number; timestamp: number }> = {};
const CACHE_DURATION = 60 * 1000; // 1 minute

/**
 * Fetch USD price for a token symbol
 * Returns null if price cannot be fetched (graceful degradation)
 */
export async function getTokenUSDPrice(symbol: string): Promise<number | null> {
  try {
    const upperSymbol = symbol.toUpperCase();
    const coinId = TOKEN_TO_COINGECKO_ID[upperSymbol];

    if (!coinId) {
      // Token not in our mapping, skip pricing
      return null;
    }

    // Check cache
    const cached = priceCache[coinId];
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.price;
    }

    // Fetch from CoinGecko
    const response = await fetch(
      `${COINGECKO_API}/simple/price?ids=${coinId}&vs_currencies=usd`,
      {
        headers: {
          Accept: "application/json",
        },
      }
    );

    if (!response.ok) {
      console.warn(`Failed to fetch price for ${symbol}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const price = data[coinId]?.usd;

    if (typeof price === "number") {
      // Cache the price
      priceCache[coinId] = { price, timestamp: Date.now() };
      return price;
    }

    return null;
  } catch (error) {
    // Graceful degradation - don't break the UI if pricing fails
    console.warn(`Error fetching USD price for ${symbol}:`, error);
    return null;
  }
}

/**
 * Fetch multiple token prices at once (more efficient)
 */
export async function getMultipleTokenPrices(
  symbols: string[]
): Promise<Record<string, number | null>> {
  try {
    const uniqueSymbols = [...new Set(symbols.map((s) => s.toUpperCase()))];
    const coinIds = uniqueSymbols
      .map((s) => TOKEN_TO_COINGECKO_ID[s])
      .filter(Boolean);

    if (coinIds.length === 0) {
      return {};
    }

    // Check cache for all coins
    const result: Record<string, number | null> = {};
    const coinsToFetch: string[] = [];

    for (const symbol of uniqueSymbols) {
      const coinId = TOKEN_TO_COINGECKO_ID[symbol];
      if (!coinId) {
        result[symbol] = null;
        continue;
      }

      const cached = priceCache[coinId];
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        result[symbol] = cached.price;
      } else {
        coinsToFetch.push(coinId);
      }
    }

    // Fetch uncached prices
    if (coinsToFetch.length > 0) {
      const response = await fetch(
        `${COINGECKO_API}/simple/price?ids=${coinsToFetch.join(",")}&vs_currencies=usd`,
        {
          headers: {
            Accept: "application/json",
          },
        }
      );

      if (response.ok) {
        const data = await response.json();

        for (const symbol of uniqueSymbols) {
          const coinId = TOKEN_TO_COINGECKO_ID[symbol];
          if (!coinId) continue;

          const price = data[coinId]?.usd;
          if (typeof price === "number") {
            priceCache[coinId] = { price, timestamp: Date.now() };
            result[symbol] = price;
          } else if (!(symbol in result)) {
            result[symbol] = null;
          }
        }
      }
    }

    return result;
  } catch (error) {
    console.warn("Error fetching multiple token prices:", error);
    return {};
  }
}

/**
 * Format USD value with proper decimals
 */
export function formatUSD(value: number): string {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  } else if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(2)}K`;
  } else if (value >= 1) {
    return `$${value.toFixed(2)}`;
  } else {
    return `$${value.toFixed(4)}`;
  }
}
