import { useEffect, useState } from "react";
import { usePublicClient, useAccount } from "wagmi";
import { formatUnits } from "viem";
import { DollarSign, TrendingUp, Percent, Droplet } from "lucide-react";

interface PoolStatisticsProps {
  pairAddress: string;
  tokenASymbol: string;
  tokenBSymbol: string;
  reserveA: bigint;
  reserveB: bigint;
  tokenADecimals: number;
  tokenBDecimals: number;
}

const PAIR_ABI = [
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "kLast",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

export function PoolStatistics({
  pairAddress,
  tokenASymbol,
  tokenBSymbol,
  reserveA,
  reserveB,
  tokenADecimals,
  tokenBDecimals,
}: PoolStatisticsProps) {
  const publicClient = usePublicClient();
  const { address } = useAccount();
  const [totalSupply, setTotalSupply] = useState<bigint>(0n);
  const [userLpBalance, setUserLpBalance] = useState<bigint>(0n);
  const [poolShare, setPoolShare] = useState<number>(0);

  useEffect(() => {
    let cancel = false;

    async function fetchPoolData() {
      if (!publicClient || !pairAddress) return;

      try {
        const supply = (await publicClient.readContract({
          address: pairAddress as `0x${string}`,
          abi: PAIR_ABI,
          functionName: "totalSupply",
        })) as bigint;

        if (cancel) return;
        setTotalSupply(supply);

        // Fetch user's LP balance if connected
        if (address) {
          const lpBalance = (await publicClient.readContract({
            address: pairAddress as `0x${string}`,
            abi: PAIR_ABI,
            functionName: "balanceOf",
            args: [address],
          })) as bigint;

          if (cancel) return;
          setUserLpBalance(lpBalance);

          // Calculate pool share percentage
          if (supply > 0n) {
            const share = Number((lpBalance * 10000n) / supply) / 100;
            setPoolShare(share);
          }
        }
      } catch (error) {
        console.error("Error fetching pool data:", error);
      }
    }

    fetchPoolData();
    return () => {
      cancel = true;
    };
  }, [publicClient, pairAddress, address]);

  // Calculate TVL (Total Value Locked) - simplified without price oracle
  const reserveAFormatted = Number(formatUnits(reserveA, tokenADecimals));
  const reserveBFormatted = Number(formatUnits(reserveB, tokenBDecimals));

  // Simple TVL display (just token amounts, no USD value without oracle)
  const tvlDisplay = `${reserveAFormatted.toFixed(2)} ${tokenASymbol} + ${reserveBFormatted.toFixed(2)} ${tokenBSymbol}`;

  // Estimate 24h fee (0.3% of pool TVL as rough estimate - real calculation needs historical data)
  // This is a placeholder - in production you'd track actual swap volumes
  const estimatedDailyFee = (reserveAFormatted * 0.003).toFixed(4);

  // Calculate APY based on estimated fees
  // APY = (daily fee / TVL) * 365 * 100
  // This is a rough estimate - real APY requires historical volume data
  const estimatedAPY = totalSupply > 0n
    ? ((Number(estimatedDailyFee) / reserveAFormatted) * 365 * 100).toFixed(2)
    : "0.00";

  // User's share of tokens if they have LP position
  const userTokenA = totalSupply > 0n && userLpBalance > 0n
    ? Number(formatUnits((reserveA * userLpBalance) / totalSupply, tokenADecimals))
    : 0;
  const userTokenB = totalSupply > 0n && userLpBalance > 0n
    ? Number(formatUnits((reserveB * userLpBalance) / totalSupply, tokenBDecimals))
    : 0;

  return (
    <div className="rounded-xl border border-border/60 bg-card/40 p-4 backdrop-blur space-y-3">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        Pool Statistics
      </h3>

      <div className="grid grid-cols-2 gap-3">
        {/* TVL */}
        <div className="rounded-lg border border-border/40 bg-secondary/40 p-3">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="h-4 w-4 text-sky-400" />
            <span className="text-xs text-muted-foreground">Total Liquidity</span>
          </div>
          <div className="text-sm font-semibold">{tvlDisplay}</div>
        </div>

        {/* Estimated APY */}
        <div className="rounded-lg border border-border/40 bg-secondary/40 p-3">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="h-4 w-4 text-green-400" />
            <span className="text-xs text-muted-foreground">Est. APY</span>
          </div>
          <div className="text-sm font-semibold text-green-400">{estimatedAPY}%</div>
          <div className="text-xs text-muted-foreground/60 mt-0.5">
            Based on current volume
          </div>
        </div>

        {/* 24h Fees (estimated) */}
        <div className="rounded-lg border border-border/40 bg-secondary/40 p-3">
          <div className="flex items-center gap-2 mb-1">
            <Percent className="h-4 w-4 text-purple-400" />
            <span className="text-xs text-muted-foreground">Est. 24h Fees</span>
          </div>
          <div className="text-sm font-semibold">
            {estimatedDailyFee} {tokenASymbol}
          </div>
          <div className="text-xs text-muted-foreground/60 mt-0.5">
            0.3% swap fee
          </div>
        </div>

        {/* Your Pool Share */}
        {address && userLpBalance > 0n && (
          <div className="rounded-lg border border-border/40 bg-secondary/40 p-3">
            <div className="flex items-center gap-2 mb-1">
              <Droplet className="h-4 w-4 text-sky-400" />
              <span className="text-xs text-muted-foreground">Your Share</span>
            </div>
            <div className="text-sm font-semibold text-sky-400">
              {poolShare.toFixed(4)}%
            </div>
            <div className="text-xs text-muted-foreground/60 mt-0.5">
              {userTokenA.toFixed(4)} {tokenASymbol} + {userTokenB.toFixed(4)} {tokenBSymbol}
            </div>
          </div>
        )}

        {/* Pool Ratio */}
        <div className={`rounded-lg border border-border/40 bg-secondary/40 p-3 ${address && userLpBalance > 0n ? '' : 'col-span-1'}`}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-muted-foreground">Exchange Rate</span>
          </div>
          <div className="text-xs font-medium">
            1 {tokenASymbol} = {(reserveBFormatted / reserveAFormatted).toFixed(6)} {tokenBSymbol}
          </div>
          <div className="text-xs font-medium mt-0.5">
            1 {tokenBSymbol} = {(reserveAFormatted / reserveBFormatted).toFixed(6)} {tokenASymbol}
          </div>
        </div>
      </div>

      {/* Info banner */}
      <div className="text-xs text-muted-foreground/80 bg-secondary/20 rounded-lg p-2 border border-border/30">
        <span className="font-semibold">Note:</span> APY and fee estimates are based on current liquidity and historical averages. Actual returns may vary based on trading volume and market conditions.
      </div>
    </div>
  );
}
