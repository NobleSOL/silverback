import { DollarSign, Activity, Droplets, TrendingUp } from "lucide-react";

interface PoolDashboardProps {
  totalTVL: string;
  totalPools: number;
  totalVolume24h?: string;
  avgAPY?: string;
}

export function PoolDashboard({ totalTVL, totalPools, totalVolume24h, avgAPY }: PoolDashboardProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      {/* Total TVL */}
      <div className="rounded-xl border border-border/60 bg-card/60 backdrop-blur p-4 shadow-lg">
        <div className="flex items-center gap-2 mb-2">
          <div className="rounded-full bg-sky-500/10 p-2">
            <DollarSign className="h-4 w-4 text-sky-400" />
          </div>
          <span className="text-xs text-muted-foreground font-medium">TOTAL TVL</span>
        </div>
        <div className="text-2xl font-bold">{totalTVL || '-'}</div>
        <div className="text-xs text-muted-foreground mt-1">Across all pools</div>
      </div>

      {/* Total Pools */}
      <div className="rounded-xl border border-border/60 bg-card/60 backdrop-blur p-4 shadow-lg">
        <div className="flex items-center gap-2 mb-2">
          <div className="rounded-full bg-purple-500/10 p-2">
            <Droplets className="h-4 w-4 text-purple-400" />
          </div>
          <span className="text-xs text-muted-foreground font-medium">ACTIVE POOLS</span>
        </div>
        <div className="text-2xl font-bold">{totalPools}</div>
        <div className="text-xs text-muted-foreground mt-1">Liquidity pairs</div>
      </div>

      {/* 24h Volume */}
      <div className="rounded-xl border border-border/60 bg-card/60 backdrop-blur p-4 shadow-lg">
        <div className="flex items-center gap-2 mb-2">
          <div className="rounded-full bg-green-500/10 p-2">
            <Activity className="h-4 w-4 text-green-400" />
          </div>
          <span className="text-xs text-muted-foreground font-medium">24H VOLUME</span>
        </div>
        <div className="text-2xl font-bold">{totalVolume24h || '-'}</div>
        <div className="text-xs text-muted-foreground mt-1">Trading activity</div>
      </div>

      {/* Average APY */}
      <div className="rounded-xl border border-border/60 bg-card/60 backdrop-blur p-4 shadow-lg">
        <div className="flex items-center gap-2 mb-2">
          <div className="rounded-full bg-amber-500/10 p-2">
            <TrendingUp className="h-4 w-4 text-amber-400" />
          </div>
          <span className="text-xs text-muted-foreground font-medium">AVG APY</span>
        </div>
        <div className="text-2xl font-bold text-amber-400">{avgAPY || '-'}%</div>
        <div className="text-xs text-muted-foreground mt-1">Est. returns</div>
      </div>
    </div>
  );
}
