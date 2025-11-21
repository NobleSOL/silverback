import { useEffect, useState } from "react";
import { useAccount, useReadContract, usePublicClient } from "wagmi";
import { formatUnits, type Address, getContract } from "viem";
import { ActivePoolCard, type PoolCardData } from "./ActivePoolCard";
import { PoolDashboard } from "./PoolDashboard";
import { SILVERBACK_V2_FACTORY } from "@/amm/config";
import { tokenBySymbol } from "@/lib/tokens";
import { getMultipleTokenPrices, formatUSD } from "@/lib/pricing";

// Extended ABIs for fetching pool data
const factoryAbi = [
  {
    type: "function",
    name: "allPairsLength",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allPairs",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const pairAbi = [
  {
    type: "function",
    name: "token0",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "token1",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "getReserves",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "reserve0", type: "uint112" },
      { name: "reserve1", type: "uint112" },
      { name: "blockTimestampLast", type: "uint32" },
    ],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const erc20Abi = [
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

// Blacklisted pool addresses (test pools, deprecated pools, etc.)
const BLACKLISTED_POOLS = [
  "0xC630C180e6C8eb0be3826D97A5766FfA3880BaDb", // WETH/SBTEST test pool
].map(addr => addr.toLowerCase());

interface ActivePoolsListProps {
  onManage: (pool: PoolCardData) => void;
}

export function ActivePoolsList({ onManage }: ActivePoolsListProps) {
  const { address: userAddress } = useAccount();
  const publicClient = usePublicClient();
  const [pools, setPools] = useState<PoolCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterMyPools, setFilterMyPools] = useState(false);
  const [sortBy, setSortBy] = useState<"tvl" | "apy" | "share">("tvl");
  const [currentPage, setCurrentPage] = useState(1);
  const poolsPerPage = 9;
  const [tokenPrices, setTokenPrices] = useState<Record<string, number | null>>({});

  // Get total number of pairs
  const { data: pairsLength, isError, isLoading, error } = useReadContract({
    address: SILVERBACK_V2_FACTORY as Address,
    abi: factoryAbi,
    functionName: "allPairsLength",
  });

  // Log contract read status for debugging Safari issues
  useEffect(() => {
    console.log('Factory contract read status:', {
      pairsLength: pairsLength?.toString(),
      isLoading,
      isError,
      error: error?.message,
      factory: SILVERBACK_V2_FACTORY
    });
  }, [pairsLength, isLoading, isError, error]);

  // Fetch all pool data
  useEffect(() => {
    if (!pairsLength || !publicClient) {
      console.log('ActivePoolsList: Missing dependencies', { pairsLength, hasPublicClient: !!publicClient });
      return;
    }

    const fetchPools = async () => {
      setLoading(true);
      const poolsData: PoolCardData[] = [];

      try {
        const length = Number(pairsLength);
        console.log('ActivePoolsList: Fetching', length, 'pairs from factory:', SILVERBACK_V2_FACTORY);

        const factory = getContract({
          address: SILVERBACK_V2_FACTORY as Address,
          abi: factoryAbi,
          client: publicClient,
        });

        // Fetch all pair addresses
        const pairAddresses: Address[] = [];
        for (let i = 0; i < length; i++) {
          try {
            const pairAddr = await factory.read.allPairs([BigInt(i)]);
            if (pairAddr && pairAddr !== "0x0000000000000000000000000000000000000000") {
              // Filter out blacklisted pools
              if (!BLACKLISTED_POOLS.includes(pairAddr.toLowerCase())) {
                pairAddresses.push(pairAddr as Address);
              } else {
                console.log('ActivePoolsList: Skipping blacklisted pool:', pairAddr);
              }
            }
          } catch (err) {
            console.error(`Error fetching pair ${i}:`, err);
          }
        }

        // Fetch data for each pair
        for (const pairAddress of pairAddresses) {
          try {
            const pair = getContract({
              address: pairAddress,
              abi: pairAbi,
              client: publicClient,
            });

            // Fetch pair data
            const [token0Addr, token1Addr, reserves, totalSupply] = await Promise.all([
              pair.read.token0(),
              pair.read.token1(),
              pair.read.getReserves(),
              pair.read.totalSupply(),
            ]);

            // Fetch token info
            const token0Contract = getContract({
              address: token0Addr as Address,
              abi: erc20Abi,
              client: publicClient,
            });
            const token1Contract = getContract({
              address: token1Addr as Address,
              abi: erc20Abi,
              client: publicClient,
            });

            const [symbol0, decimals0, symbol1, decimals1] = await Promise.all([
              token0Contract.read.symbol(),
              token0Contract.read.decimals(),
              token1Contract.read.symbol(),
              token1Contract.read.decimals(),
            ]);

            // Fetch user LP balance if connected
            let userLpBalance: bigint | undefined;
            let userPoolShare: number | undefined;
            if (userAddress) {
              userLpBalance = await pair.read.balanceOf([userAddress]);
              if (userLpBalance > 0n && totalSupply > 0n) {
                userPoolShare = (Number(userLpBalance) / Number(totalSupply)) * 100;
              }
            }

            // Get logo URLs from token metadata
            const token0Meta = tokenBySymbol(symbol0 as string);
            const token1Meta = tokenBySymbol(symbol1 as string);

            // Create pool data
            const poolData: PoolCardData = {
              pairAddress: pairAddress,
              tokenA: {
                symbol: symbol0 as string,
                address: token0Addr as string,
                decimals: decimals0 as number,
                logo: token0Meta.logo,
              },
              tokenB: {
                symbol: symbol1 as string,
                address: token1Addr as string,
                decimals: decimals1 as number,
                logo: token1Meta.logo,
              },
              reserveA: reserves[0] as bigint,
              reserveB: reserves[1] as bigint,
              totalSupply: totalSupply as bigint,
              userLpBalance,
              userPoolShare,
            };

            poolsData.push(poolData);
          } catch (err) {
            console.error(`Error fetching pool data for ${pairAddress}:`, err);
          }
        }

        console.log('ActivePoolsList: Successfully fetched', poolsData.length, 'pools');
        setPools(poolsData);

        // Fetch USD prices for all unique tokens (optional, won't break if it fails)
        const uniqueSymbols = new Set<string>();
        poolsData.forEach((pool) => {
          uniqueSymbols.add(pool.tokenA.symbol);
          uniqueSymbols.add(pool.tokenB.symbol);
        });

        if (uniqueSymbols.size > 0) {
          getMultipleTokenPrices(Array.from(uniqueSymbols))
            .then((prices) => setTokenPrices(prices))
            .catch((err) => console.warn("Failed to fetch USD prices:", err));
        }
      } catch (error) {
        console.error("Error fetching pools:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchPools();
  }, [pairsLength, userAddress, publicClient]);

  // Calculate dashboard stats
  const calculateDashboardStats = () => {
    if (pools.length === 0) {
      return {
        totalTVL: "-",
        totalPools: 0,
        totalVolume24h: "-",
        avgAPY: "-",
      };
    }

    // Calculate total TVL with USD pricing if available
    let totalTVLUSD = 0;
    let totalAPY = 0;
    let hasUSDPrices = false;

    pools.forEach((pool) => {
      const reserveA = Number(formatUnits(pool.reserveA, pool.tokenA.decimals));
      const reserveB = Number(formatUnits(pool.reserveB, pool.tokenB.decimals));

      // Try to calculate USD value
      const priceA = tokenPrices[pool.tokenA.symbol];
      const priceB = tokenPrices[pool.tokenB.symbol];

      if (priceA !== null && priceA !== undefined) {
        totalTVLUSD += reserveA * priceA;
        hasUSDPrices = true;
      }
      if (priceB !== null && priceB !== undefined) {
        totalTVLUSD += reserveB * priceB;
        hasUSDPrices = true;
      }

      // Calculate APY for this pool (assumes 10% of TVL trades daily)
      const assumedDailyVolumePercent = 0.1;
      const apy = (assumedDailyVolumePercent * 0.003 * 365) * 100;
      totalAPY += apy;
    });

    const avgAPY = pools.length > 0 ? totalAPY / pools.length : 0;

    return {
      totalTVL: hasUSDPrices ? formatUSD(totalTVLUSD) : "-",
      totalPools: pools.length,
      totalVolume24h: "-", // Would need historical data
      avgAPY: avgAPY.toFixed(2),
    };
  };

  const dashboardStats = calculateDashboardStats();

  // Filter out pools with zero liquidity
  let filteredPools = pools.filter(
    (pool) => pool.reserveA > 0n && pool.reserveB > 0n
  );

  // Apply "My Pools" filter
  if (filterMyPools) {
    filteredPools = filteredPools.filter(
      (pool) => pool.userLpBalance && pool.userLpBalance > 0n
    );
  }

  // Sort pools based on selected sort option
  const sortedPools = [...filteredPools].sort((a, b) => {
    if (sortBy === "tvl") {
      const aReserve = Number(formatUnits(a.reserveA, a.tokenA.decimals));
      const bReserve = Number(formatUnits(b.reserveA, b.tokenA.decimals));
      return bReserve - aReserve;
    } else if (sortBy === "apy") {
      // Since all pools now have the same APY estimate (10.95%), sort by TVL instead
      const aReserve = Number(formatUnits(a.reserveA, a.tokenA.decimals));
      const bReserve = Number(formatUnits(b.reserveA, b.tokenA.decimals));
      return bReserve - aReserve;
    } else if (sortBy === "share") {
      const aShare = a.userPoolShare ?? 0;
      const bShare = b.userPoolShare ?? 0;
      return bShare - aShare;
    }
    return 0;
  });

  // Pagination
  const totalPages = Math.ceil(sortedPools.length / poolsPerPage);
  const startIndex = (currentPage - 1) * poolsPerPage;
  const endIndex = startIndex + poolsPerPage;
  const paginatedPools = sortedPools.slice(startIndex, endIndex);

  // Reset to page 1 when filters/sort changes
  useEffect(() => {
    setCurrentPage(1);
  }, [filterMyPools, sortBy]);

  return (
    <div className="space-y-6">
      {/* Dashboard Stats */}
      <PoolDashboard
        totalTVL={dashboardStats.totalTVL}
        totalPools={dashboardStats.totalPools}
        totalVolume24h={dashboardStats.totalVolume24h}
        avgAPY={dashboardStats.avgAPY}
      />

      {/* Active Pools Section */}
      <div>
        <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Active Pools</h3>
            <p className="text-sm text-muted-foreground">
              {sortedPools.length} liquidity pool{sortedPools.length !== 1 ? 's' : ''} on Silverback
            </p>
          </div>

          {/* Filter and Sort Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Create Pool Button */}
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-brand text-white hover:bg-brand/90 transition-all shadow-sm"
            >
              + Create Pool
            </button>

            {/* My Pools Filter */}
            {userAddress && (
              <button
                onClick={() => setFilterMyPools(!filterMyPools)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  filterMyPools
                    ? "bg-brand text-white"
                    : "bg-secondary/60 hover:bg-secondary/80 border border-border/40"
                }`}
              >
                My Pools
              </button>
            )}

            {/* Sort Dropdown */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as "tvl" | "apy" | "share")}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-secondary/60 border border-border/40 hover:bg-secondary/80 transition-all cursor-pointer"
            >
              <option value="tvl">Sort by TVL</option>
              <option value="apy">Sort by APY</option>
              {userAddress && <option value="share">Sort by My Share</option>}
            </select>
          </div>
        </div>

        {isError ? (
          <div className="rounded-xl border border-red-500/60 bg-red-500/10 backdrop-blur p-8 text-center">
            <p className="text-red-400 font-medium mb-2">Failed to load pools</p>
            <p className="text-sm text-muted-foreground">{error?.message || 'Unknown error'}</p>
            <p className="text-xs text-muted-foreground mt-2">Factory: {SILVERBACK_V2_FACTORY}</p>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center space-y-2">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand mx-auto"></div>
              <p className="text-sm text-muted-foreground">Loading pools...</p>
            </div>
          </div>
        ) : sortedPools.length === 0 ? (
          <div className="rounded-xl border border-border/60 bg-card/40 backdrop-blur p-8 text-center">
            <p className="text-muted-foreground">
              {filterMyPools ? "You don't have any pool positions yet" : "No active pools found"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {filterMyPools
                ? "Add liquidity to a pool to see it here"
                : "Create the first pool by adding liquidity above"}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {paginatedPools.map((pool) => (
                <ActivePoolCard
                  key={pool.pairAddress}
                  pool={pool}
                  onManage={onManage}
                />
              ))}
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-6">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium bg-secondary/60 hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed border border-border/40 transition-all"
                >
                  Previous
                </button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={`w-8 h-8 rounded-lg text-sm font-medium transition-all ${
                        currentPage === page
                          ? "bg-brand text-white"
                          : "bg-secondary/60 hover:bg-secondary/80 border border-border/40"
                      }`}
                    >
                      {page}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium bg-secondary/60 hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed border border-border/40 transition-all"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
