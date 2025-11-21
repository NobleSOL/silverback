import { TrendingUp, Droplet, ArrowRight, Coins, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export interface KeetaPoolCardData {
  poolAddress: string;
  tokenA: string;
  tokenB: string;
  symbolA: string;
  symbolB: string;
  reserveA: string;
  reserveB: string;
  reserveAHuman: number;
  reserveBHuman: number;
  decimalsA?: number;
  decimalsB?: number;
  totalShares: string;
  apy?: number; // Real APY from backend (calculated from 24h reserve growth)
  volume24h?: number; // 24h trading volume
  tvl?: number; // Total value locked
  userPosition?: {
    shares: string;
    sharePercent: number;
    amountA: string;
    amountB: string;
  };
}

export function KeetaPoolCard({
  pool,
  onManage,
  onRemoveLiquidity
}: {
  pool: KeetaPoolCardData;
  onManage: (pool: KeetaPoolCardData) => void;
  onRemoveLiquidity?: (pool: KeetaPoolCardData, percent: number) => Promise<void>;
}) {
  // Handle undefined reserves gracefully
  const reserveAHuman = pool.reserveAHuman ?? 0;
  const reserveBHuman = pool.reserveBHuman ?? 0;

  // Debug logging
  console.log('🔍 KeetaPoolCard rendering:', {
    poolAddress: pool.poolAddress.slice(-8),
    reserveAHuman,
    reserveBHuman,
    symbolA: pool.symbolA,
    symbolB: pool.symbolB
  });

  // Calculate TVL display
  const tvl = `${reserveAHuman.toFixed(2)} ${pool.symbolA} + ${reserveBHuman.toFixed(2)} ${pool.symbolB}`;

  // Use real APY from backend (calculated from 24h reserve growth)
  // Falls back to 0 if APY data is not available yet (no 24h snapshot)
  const apy = pool.apy !== undefined ? pool.apy.toFixed(2) : "0.00";

  // User's position
  const hasPosition = pool.userPosition && pool.userPosition.sharePercent > 0;
  // amountA and amountB are already human-readable strings from the API (e.g., "1.008974")
  const userAmountA = hasPosition ? parseFloat(pool.userPosition!.amountA) : 0;
  const userAmountB = hasPosition ? parseFloat(pool.userPosition!.amountB) : 0;

  // Estimated fee earnings (protocol fee goes to treasury, but LPs earn from price impact)
  const estimatedDailyVolume = reserveAHuman * 0.1;
  const totalDailyFees = estimatedDailyVolume * 0.003;
  const userDailyFees = hasPosition
    ? (totalDailyFees * pool.userPosition!.sharePercent / 100)
    : 0;

  // State for position management
  const [removeLiqPercent, setRemoveLiqPercent] = useState(100);
  const [removingLiq, setRemovingLiq] = useState(false);
  const [showManagement, setShowManagement] = useState(false);

  const handleRemoveLiquidity = async (percent: number) => {
    if (!onRemoveLiquidity) return;

    setRemovingLiq(true);
    try {
      await onRemoveLiquidity(pool, percent);
    } finally {
      setRemovingLiq(false);
      setShowManagement(false);
    }
  };

  return (
    <div className={`rounded-xl border bg-card/40 backdrop-blur p-3 sm:p-4 transition-all hover:border-brand/50 hover:shadow-lg w-full min-w-0 ${hasPosition ? 'border-brand/30 bg-brand/5' : 'border-border/60'}`}>
      <div className="flex items-start justify-between mb-3 min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Token pair display */}
          <div className="flex items-center">
            {pool.symbolA === "KTA" ? (
              <div className="w-8 h-8 rounded-full shadow-md border-2 border-background overflow-hidden">
                <img
                  src="https://assets.kraken.com/marketing/web/icons-uni-webp/s_kta.webp?i=kds"
                  alt="KTA"
                  className="h-full w-full object-cover"
                />
              </div>
            ) : (
              <div className="w-8 h-8 rounded-full shadow-md border-2 border-background bg-gradient-to-br from-brand/20 to-brand/10 flex items-center justify-center text-xs font-bold text-brand">
                {pool.symbolA.slice(0, 2)}
              </div>
            )}
            {pool.symbolB === "KTA" ? (
              <div className="w-8 h-8 rounded-full shadow-md border-2 border-background overflow-hidden -ml-2">
                <img
                  src="https://assets.kraken.com/marketing/web/icons-uni-webp/s_kta.webp?i=kds"
                  alt="KTA"
                  className="h-full w-full object-cover"
                />
              </div>
            ) : (
              <div className="w-8 h-8 rounded-full shadow-md border-2 border-background -ml-2 bg-gradient-to-br from-brand/20 to-brand/10 flex items-center justify-center text-xs font-bold text-brand">
                {pool.symbolB.slice(0, 2)}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm">
              {pool.symbolA}/{pool.symbolB}
            </div>
            <div className="text-xs text-muted-foreground">
              Silverback Pool
            </div>
            <a
              href={`https://explorer.test.keeta.com/account/${pool.poolAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-sky-400 hover:text-sky-300 transition-colors truncate block max-w-[200px]"
            >
              {pool.poolAddress.slice(0, 12)}...{pool.poolAddress.slice(-8)}
            </a>
          </div>
        </div>

        {hasPosition && (
          <div className="rounded-full bg-brand/20 px-2 py-0.5 text-xs font-medium text-white">
            Your Pool
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:gap-3 mb-3">
        {/* TVL */}
        <div className="rounded-lg border border-border/40 bg-secondary/40 p-2 min-w-0">
          <div className="text-xs text-muted-foreground mb-1">Total Liquidity</div>
          <div className="text-xs font-semibold leading-tight break-words">{tvl}</div>
        </div>

        {/* APY */}
        <div className="rounded-lg border border-border/40 bg-secondary/40 p-2 min-w-0">
          <div className="flex items-center gap-1 mb-1">
            <TrendingUp className="h-3 w-3 text-green-400 flex-shrink-0" />
            <span className="text-xs text-muted-foreground">APY</span>
          </div>
          <div className="text-xs font-semibold text-green-400">{apy}%</div>
        </div>
      </div>

      {/* User Position */}
      {hasPosition && (
        <>
          <div className="rounded-lg border border-brand/40 bg-brand/10 p-2 mb-2">
            <div className="flex items-center gap-1 mb-1">
              <Droplet className="h-3 w-3 text-sky-400" />
              <span className="text-xs text-muted-foreground">Your Position</span>
            </div>
            <div className="text-xs font-semibold text-sky-400">
              {Number(pool.userPosition?.sharePercent || 0).toFixed(4)}% of pool
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {userAmountA.toFixed(4)} {pool.symbolA} + {userAmountB.toFixed(4)} {pool.symbolB}
            </div>
          </div>

          {/* Earnings Estimate */}
          <div className="rounded-lg border border-green-500/40 bg-green-500/10 p-2 mb-3">
            <div className="flex items-center gap-1 mb-1">
              <Coins className="h-3 w-3 text-green-400" />
              <span className="text-xs text-muted-foreground">Est. Earnings</span>
            </div>
            <div className="text-xs font-semibold text-green-400">
              ~{userDailyFees.toFixed(6)} {pool.symbolA}/day
            </div>
          </div>
        </>
      )}

      {/* Exchange Rate */}
      <div className="text-xs text-muted-foreground mb-3 space-y-0.5">
        <div>1 {pool.symbolA} = {reserveAHuman > 0 ? (reserveBHuman / reserveAHuman).toFixed(6) : '0.000000'} {pool.symbolB}</div>
        <div>1 {pool.symbolB} = {reserveBHuman > 0 ? (reserveAHuman / reserveBHuman).toFixed(6) : '0.000000'} {pool.symbolA}</div>
      </div>

      {/* Action buttons */}
      {hasPosition ? (
        showManagement ? (
          // Show position management UI
          <div className="space-y-3">
            {/* Remove Liquidity Controls */}
            <div className="rounded-lg border border-brand/40 bg-brand/10 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">Remove Liquidity</span>
                <span className="text-sm font-semibold text-sky-400">{removeLiqPercent}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={removeLiqPercent}
                onChange={(e) => setRemoveLiqPercent(Number(e.target.value))}
                className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-sky-400"
              />
              <div className="flex gap-1 mt-2">
                {[25, 50, 75, 100].map((percent) => (
                  <Button
                    key={percent}
                    variant="outline"
                    size="sm"
                    onClick={() => setRemoveLiqPercent(percent)}
                    className="flex-1 text-xs h-7"
                  >
                    {percent}%
                  </Button>
                ))}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2">
              <Button
                onClick={() => setShowManagement(false)}
                variant="outline"
                size="sm"
                className="flex-1 text-xs h-8"
              >
                Cancel
              </Button>
              <Button
                onClick={() => handleRemoveLiquidity(removeLiqPercent)}
                disabled={removingLiq}
                variant="destructive"
                size="sm"
                className="flex-1 text-xs h-8"
              >
                {removingLiq ? (
                  <>
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                    Removing...
                  </>
                ) : (
                  `Remove ${removeLiqPercent}%`
                )}
              </Button>
            </div>
          </div>
        ) : (
          // Show Manage/Add buttons
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-xs h-8"
              onClick={() => onManage(pool)}
            >
              Add More
              <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="flex-1 text-xs h-8"
              onClick={() => setShowManagement(true)}
            >
              Remove
            </Button>
          </div>
        )
      ) : (
        // No position - show Add Liquidity button
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-xs h-8"
            onClick={() => onManage(pool)}
          >
            Add Liquidity
            <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}
