import React, { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import {
  Loader2,
  Wallet,
  Plus,
  ArrowDownUp,
  DollarSign,
  Activity,
  Droplets,
  TrendingUp,
} from "lucide-react";
import { useKeetaWallet } from "@/contexts/KeetaWalletContext";
import KeetaTokenSelector, { type KeetaToken } from "@/components/keeta/KeetaTokenSelector";
import TokenLogo from "@/components/shared/TokenLogo";
import { KeetaPoolCard, KeetaPoolCardData } from "@/components/keeta/KeetaPoolCard";

// API base URL
const API_BASE = import.meta.env.VITE_KEETA_API_BASE || `${window.location.origin}/api`;

// KTA logo URL (Kraken CDN)
const KTA_LOGO = "https://assets.kraken.com/marketing/web/icons-uni-webp/s_kta.webp?i=kds";

const getTokenLogo = (symbol: string, defaultUrl?: string) => {
  if (symbol === "KTA") return KTA_LOGO;
  return defaultUrl;
};

interface AnchorPool {
  pool_address: string;
  creator_address: string;
  token_a: string;
  token_b: string;
  pair_key: string;
  fee_bps: number;
  status: 'active' | 'paused' | 'closed'; // 'paused' supported in backend but not shown in UI
  created_at: string;
  volume24h?: string;
  swapCount24h?: number;
  feesCollected24h?: string;
  // Token metadata from backend
  symbolA?: string;
  symbolB?: string;
  decimalsA?: number;
  decimalsB?: number;
  iconA?: string | null;
  iconB?: string | null;
  // Reserve data from backend
  reserveA?: string;
  reserveB?: string;
  reserveAHuman?: number;
  reserveBHuman?: number;
  totalShares?: string;
  // User position data from backend
  userPosition?: {
    shares: string;
    sharePercent: number;
    amountA: string;
    amountB: string;
  };
}

export default function MyAnchors() {
  const { wallet, sortedTokens, tokenPrices, connectKeythingsWallet, loading } = useKeetaWallet();

  const [myPools, setMyPools] = useState<AnchorPool[]>([]);
  const [loadingPools, setLoadingPools] = useState(false);

  // Create pool state
  const [createMode, setCreateMode] = useState(false);
  const [tokenA, setTokenA] = useState<string>("");
  const [tokenB, setTokenB] = useState<string>("");
  const [amountA, setAmountA] = useState<string>("");
  const [amountB, setAmountB] = useState<string>("");
  const [feeBps, setFeeBps] = useState(30); // 0.3% default
  const [feeInput, setFeeInput] = useState("0.30"); // String for free typing
  const [creatingPool, setCreatingPool] = useState(false);
  const [selectingToken, setSelectingToken] = useState<"tokenA" | "tokenB" | null>(null);

  // Update pool state
  const [updatingPool, setUpdatingPool] = useState<string | null>(null);
  const [updatingFee, setUpdatingFee] = useState<{ poolAddress: string; fee: number } | null>(null);

  // Remove liquidity state
  const [removingLiq, setRemovingLiq] = useState(false);

  // Filter state
  const [showOnlyMyPools, setShowOnlyMyPools] = useState(false);

  // Load ALL anchor pools (public) - ownership populates when wallet connected
  async function loadAllPools() {
    setLoadingPools(true);
    try {
      // Always load all pools first
      const response = await fetch(`${API_BASE}/anchor-pools`);
      const data = await response.json();

      if (data.success) {
        let pools = data.pools;

        // If wallet connected, fetch user positions to populate ownership
        if (wallet) {
          try {
            const userResponse = await fetch(`${API_BASE}/anchor-pools/creator/${wallet.address}`);
            const userData = await userResponse.json();

            if (userData.success && userData.pools) {
              // Create a map of user's pools with position data
              const userPoolMap = new Map(
                userData.pools.map((p: any) => [p.pool_address, p])
              );

              // Merge user data into all pools (prefer user endpoint data for symbols/reserves)
              pools = pools.map((pool: any) => {
                const userPool = userPoolMap.get(pool.pool_address);
                if (userPool) {
                  return {
                    ...pool,
                    // Use user endpoint data for symbols and reserves (more reliable)
                    symbolA: userPool.symbolA || pool.symbolA,
                    symbolB: userPool.symbolB || pool.symbolB,
                    decimalsA: userPool.decimalsA || pool.decimalsA,
                    decimalsB: userPool.decimalsB || pool.decimalsB,
                    reserveA: userPool.reserveA || pool.reserveA,
                    reserveB: userPool.reserveB || pool.reserveB,
                    reserveAHuman: userPool.reserveAHuman || pool.reserveAHuman,
                    reserveBHuman: userPool.reserveBHuman || pool.reserveBHuman,
                    totalShares: userPool.totalShares || pool.totalShares,
                    userPosition: userPool.userPosition,
                  };
                }
                return pool;
              });
            }
          } catch (err) {
            console.warn('Failed to fetch user positions:', err);
          }
        }

        setMyPools(pools);
      }
    } catch (error: any) {
      console.error('Failed to load anchor pools:', error);
    } finally {
      setLoadingPools(false);
    }
  }

  useEffect(() => {
    loadAllPools();
  }, [wallet]);

  async function createAnchorPool() {
    if (!wallet || !tokenA || !tokenB || !amountA || !amountB) return;

    setCreatingPool(true);
    try {
      // Step 1: Create pool structure
      const response = await fetch(`${API_BASE}/anchor-pools/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorAddress: wallet.address,
          tokenA,
          tokenB,
          amountA,
          amountB,
          feeBps,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || "Failed to create anchor pool");
      }

      const { pool } = data;

      toast({
        title: "Pool Created",
        description: "Adding initial liquidity...",
      });

      // Get token decimals
      const tokenAInfo = sortedTokens.find(t => t.address === tokenA);
      const tokenBInfo = sortedTokens.find(t => t.address === tokenB);
      const decimalsA = tokenAInfo?.decimals || 9;
      const decimalsB = tokenBInfo?.decimals || 9;

      // Convert amounts to atomic units
      const amountABigInt = BigInt(Math.floor(Number(amountA) * Math.pow(10, decimalsA)));
      const amountBBigInt = BigInt(Math.floor(Number(amountB) * Math.pow(10, decimalsB)));

      // Step 2: Add liquidity - different flow for Keythings vs seed wallets
      if (wallet.isKeythings) {
        // Keythings wallet: Use provider to sign transactions
        const { getKeythingsProvider } = await import('@/lib/keythings-provider');
        const KeetaNet = await import('@keetanetwork/keetanet-client');

        const provider = getKeythingsProvider();
        if (!provider) {
          throw new Error('Keythings provider not found');
        }

        console.log('🔐 Requesting user client from Keythings...');
        const userClient = await provider.getUserClient();

        const tokenAAccount = KeetaNet.lib.Account.fromPublicKeyString(tokenA);
        const tokenBAccount = KeetaNet.lib.Account.fromPublicKeyString(tokenB);

        // Build TX: User sends both tokens to pool
        console.log('📝 Building transaction (user sends tokens to pool)...');
        const txBuilder = userClient.initBuilder();

        // Send tokenA to pool (use pool address string, not Account object)
        txBuilder.send(pool.poolAddress, amountABigInt, tokenAAccount);

        // Send tokenB to pool
        txBuilder.send(pool.poolAddress, amountBBigInt, tokenBAccount);

        // Publish TX (will prompt user via Keythings UI)
        console.log('✍️ Prompting user to sign transaction via Keythings...');
        await userClient.publishBuilder(txBuilder);

        console.log('✅ Transaction completed');

        // Call backend to mint LP tokens
        console.log('📝 Calling backend to mint LP tokens...');
        const mintResponse = await fetch(`${API_BASE}/anchor-pools/${pool.poolAddress}/mint-lp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            creatorAddress: wallet.address,
            amountA: amountABigInt.toString(),
            amountB: amountBBigInt.toString(),
          }),
        });

        const mintData = await mintResponse.json();

        if (!mintData.success) {
          throw new Error(mintData.error || "Failed to mint LP tokens");
        }

        console.log('✅ LP tokens minted');

      } else {
        // Seed wallet: Use seed to create client
        const { createKeetaClientFromSeed } = await import("@/lib/keeta-client");
        const KeetaNet = await import('@keetanetwork/keetanet-client');
        const userClient = createKeetaClientFromSeed(wallet.seed, wallet.accountIndex || 0);

        const poolAccount = KeetaNet.lib.Account.fromPublicKeyString(pool.poolAddress);
        const tokenAAccount = KeetaNet.lib.Account.fromPublicKeyString(tokenA);
        const tokenBAccount = KeetaNet.lib.Account.fromPublicKeyString(tokenB);

        // TX1: Send token A to pool
        const tx1Builder = userClient.initBuilder();
        tx1Builder.send(poolAccount, amountABigInt, tokenAAccount);
        await userClient.publishBuilder(tx1Builder);

        // Wait for TX1 to finalize
        await new Promise(resolve => setTimeout(resolve, 2000));

        // TX2: Send token B to pool
        const tx2Builder = userClient.initBuilder();
        tx2Builder.send(poolAccount, amountBBigInt, tokenBAccount);
        await userClient.publishBuilder(tx2Builder);

        // Wait for TX2 to finalize
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Request backend to mint LP tokens
        const mintResponse = await fetch(`${API_BASE}/anchor-pools/${pool.poolAddress}/mint-lp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            creatorAddress: wallet.address,
            amountA: amountABigInt.toString(),
            amountB: amountBBigInt.toString(),
          }),
        });

        const mintData = await mintResponse.json();

        if (!mintData.success) {
          throw new Error(mintData.error || "Failed to mint LP tokens");
        }
      }

      toast({
        title: "Anchor Pool Created!",
        description: `${pool.symbolA}/${pool.symbolB} - Fee: ${(feeBps / 100).toFixed(2)}%`,
      });

      // Clear form
      setTokenA("");
      setTokenB("");
      setAmountA("");
      setAmountB("");
      setFeeBps(30);
      setFeeInput("0.30");
      setCreateMode(false);

      // Reload pools
      await loadAllPools();
    } catch (error: any) {
      console.error("Pool creation error:", error);
      toast({
        title: "Creation Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setCreatingPool(false);
    }
  }


  async function updatePoolFee(poolAddress: string, newFeeBps: number) {
    if (!wallet) return;

    setUpdatingFee({ poolAddress, fee: newFeeBps });
    try {
      const response = await fetch(`${API_BASE}/anchor-pools/${poolAddress}/update-fee`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorAddress: wallet.address,
          feeBps: newFeeBps,
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast({
          title: "Fee Updated",
          description: `New fee: ${(newFeeBps / 100).toFixed(2)}%`,
        });

        await loadAllPools();
      } else {
        throw new Error(data.error || "Failed to update fee");
      }
    } catch (error: any) {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setUpdatingFee(null);
    }
  }

  const stats = useMemo(() => {
    if (myPools.length === 0) {
      return {
        totalPools: 0,
        activePools: 0,
        totalVolume24h: "-",
        totalFees24h: "-",
        avgFee: "-",
      };
    }

    const activePools = myPools.filter(p => p.status === 'active').length;

    // Volume and fees are stored in atomic units (9 decimals for Keeta tokens)
    // Convert to human-readable format
    const DECIMALS = 9;
    const totalVolumeRaw = myPools.reduce((sum, p) => sum + parseFloat(p.volume24h || '0'), 0);
    const totalFeesRaw = myPools.reduce((sum, p) => sum + parseFloat(p.feesCollected24h || '0'), 0);

    // Divide by 10^9 to get human-readable amounts
    const totalVolume = totalVolumeRaw / Math.pow(10, DECIMALS);
    const totalFees = totalFeesRaw / Math.pow(10, DECIMALS);

    // Calculate average fee across pools
    const avgFeeBps = myPools.reduce((sum, p) => sum + p.fee_bps, 0) / myPools.length;

    return {
      totalPools: myPools.length,
      activePools,
      totalVolume24h: totalVolume > 0 ? totalVolume.toFixed(2) : "-",
      totalFees24h: totalFees > 0 ? totalFees.toFixed(6) : "-",
      avgFee: (avgFeeBps / 100).toFixed(2),
    };
  }, [myPools]);

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[radial-gradient(100%_60%_at_0%_0%,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0)_60%),radial-gradient(80%_50%_at_100%_100%,rgba(255,255,255,0.04)_0%,rgba(255,255,255,0)_50%)]">
      <div className="container py-8 sm:py-10">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold mb-2">Silverback Anchor Pools</h1>
          <p className="text-muted-foreground text-sm">
            Create and manage your own FX anchor pools to earn trading fees
          </p>
        </div>

        {/* Stats Dashboard - matching Base Pool design */}
        {myPools.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {/* Total Pools */}
            <div className="glass-card-elevated rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="rounded-full bg-purple-500/10 p-2">
                  <Droplets className="h-4 w-4 text-purple-400" />
                </div>
                <span className="text-xs text-muted-foreground font-medium">MY POOLS</span>
              </div>
              <div className="text-2xl font-bold">{stats.totalPools}</div>
              <div className="text-xs text-muted-foreground mt-1">{stats.activePools} active</div>
            </div>

            {/* 24h Volume */}
            <div className="glass-card-elevated rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="rounded-full bg-green-500/10 p-2">
                  <Activity className="h-4 w-4 text-green-400" />
                </div>
                <span className="text-xs text-muted-foreground font-medium">24H VOLUME</span>
              </div>
              <div className="text-2xl font-bold">{stats.totalVolume24h}</div>
              <div className="text-xs text-muted-foreground mt-1">Trading activity</div>
            </div>

            {/* Fees Earned */}
            <div className="glass-card-elevated rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="rounded-full bg-sky-500/10 p-2">
                  <DollarSign className="h-4 w-4 text-sky-400" />
                </div>
                <span className="text-xs text-muted-foreground font-medium">24H FEES</span>
              </div>
              <div className="text-2xl font-bold text-sky-400">{stats.totalFees24h}</div>
              <div className="text-xs text-muted-foreground mt-1">Earned from swaps</div>
            </div>

            {/* Average Fee */}
            <div className="glass-card-elevated rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="rounded-full bg-amber-500/10 p-2">
                  <TrendingUp className="h-4 w-4 text-amber-400" />
                </div>
                <span className="text-xs text-muted-foreground font-medium">AVG FEE</span>
              </div>
              <div className="text-2xl font-bold text-amber-400">{stats.avgFee}%</div>
              <div className="text-xs text-muted-foreground mt-1">Per swap</div>
            </div>
          </div>
        )}

        {/* Create/Manage Pool Section */}
        <div className="mx-auto max-w-xl glass-card-elevated rounded-2xl p-6 mb-8">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex gap-2">
              <button
                onClick={() => setCreateMode(false)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
                  !createMode
                    ? "bg-gradient-to-br from-white/20 to-white/10 border border-white/20 text-white shadow-sm"
                    : "bg-secondary/60 hover:bg-secondary/80"
                }`}
              >
                My Pools
              </button>
              <button
                onClick={() => setCreateMode(true)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
                  createMode
                    ? "bg-gradient-to-br from-white/20 to-white/10 border border-white/20 text-white shadow-sm"
                    : "bg-secondary/60 hover:bg-secondary/80"
                }`}
              >
                <Plus className="h-4 w-4 inline mr-1" />
                Create Pool
              </button>
            </div>
          </div>

          {!wallet ? (
            <div className="text-center space-y-4 py-8">
              <p className="text-muted-foreground">Connect your wallet to create FX anchor pools</p>
              <Button
                onClick={connectKeythingsWallet}
                disabled={loading}
                size="lg"
                className="gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Wallet className="h-4 w-4" />
                    Connect Keythings Wallet
                  </>
                )}
              </Button>
            </div>
          ) : createMode ? (
            // Create Pool Mode
            <div className="space-y-4">
              {/* Token A */}
              <div className="rounded-xl border border-border/60 bg-secondary/60 p-4">
                <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Token A</span>
                  {tokenA && (() => {
                    const token = sortedTokens.find(t => t.address === tokenA);
                    return token ? <span>Bal: {token.balanceFormatted}</span> : null;
                  })()}
                </div>
                <div className="flex items-center gap-3 mb-2">
                  <button
                    type="button"
                    onClick={() => setSelectingToken("tokenA")}
                    className="min-w-24 shrink-0 rounded-lg bg-card hover:bg-card/80 px-3 py-2 flex items-center gap-2 cursor-pointer transition-colors"
                  >
                    {tokenA && (() => {
                      const token = sortedTokens.find(t => t.address === tokenA);
                      return token ? (
                        <>
                          <TokenLogo src={getTokenLogo(token.symbol, token.logoUrl)} alt={token.symbol} size={20} />
                          <span className="text-sm font-semibold">{token.symbol}</span>
                        </>
                      ) : null;
                    })()}
                    {!tokenA && <span className="text-sm text-muted-foreground">Select</span>}
                  </button>
                  <input
                    inputMode="decimal"
                    pattern="^[0-9]*[.,]?[0-9]*$"
                    placeholder="0.00"
                    disabled={!tokenA}
                    value={amountA}
                    onChange={(e) => setAmountA(e.target.value.replace(",", "."))}
                    className="ml-auto flex-1 min-w-0 bg-transparent text-right text-xl font-semibold outline-none placeholder:text-muted-foreground/60 disabled:opacity-50"
                  />
                </div>
              </div>

              {/* Swap Arrow */}
              <div className="relative flex justify-center -my-2">
                <div className="rounded-xl border border-border/60 bg-card p-2 shadow-md">
                  <ArrowDownUp className="h-4 w-4" />
                </div>
              </div>

              {/* Token B */}
              <div className="rounded-xl border border-border/60 bg-secondary/60 p-4">
                <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Token B</span>
                  {tokenB && (() => {
                    const token = sortedTokens.find(t => t.address === tokenB);
                    return token ? <span>Bal: {token.balanceFormatted}</span> : null;
                  })()}
                </div>
                <div className="flex items-center gap-3 mb-2">
                  <button
                    type="button"
                    onClick={() => setSelectingToken("tokenB")}
                    disabled={!tokenA}
                    className="min-w-24 shrink-0 rounded-lg bg-card hover:bg-card/80 px-3 py-2 flex items-center gap-2 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {tokenB && (() => {
                      const token = sortedTokens.find(t => t.address === tokenB);
                      return token ? (
                        <>
                          <TokenLogo src={getTokenLogo(token.symbol, token.logoUrl)} alt={token.symbol} size={20} />
                          <span className="text-sm font-semibold">{token.symbol}</span>
                        </>
                      ) : null;
                    })()}
                    {!tokenB && <span className="text-sm text-muted-foreground">Select</span>}
                  </button>
                  <input
                    inputMode="decimal"
                    pattern="^[0-9]*[.,]?[0-9]*$"
                    placeholder="0.00"
                    disabled={!tokenB}
                    value={amountB}
                    onChange={(e) => setAmountB(e.target.value.replace(",", "."))}
                    className="ml-auto flex-1 min-w-0 bg-transparent text-right text-xl font-semibold outline-none placeholder:text-muted-foreground/60 disabled:opacity-50"
                  />
                </div>
              </div>

              {/* Fee Setting */}
              <div className="rounded-xl border border-border/60 bg-secondary/60 p-4">
                <div className="mb-2 text-xs text-muted-foreground">Trading Fee</div>
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.30"
                    value={feeInput}
                    onChange={(e) => setFeeInput(e.target.value.replace(",", "."))}
                    onBlur={() => {
                      const val = parseFloat(feeInput) || 0.3;
                      // Clamp between 0.01% and 10%
                      const clamped = Math.max(0.01, Math.min(10, val));
                      setFeeBps(Math.round(clamped * 100));
                      setFeeInput(clamped.toFixed(2));
                    }}
                    className="w-20 rounded-lg bg-card px-3 py-2 text-sm font-semibold outline-none text-right"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  0.01% - 10% max. Lower fees attract more volume!
                </div>
              </div>

              <Button
                onClick={createAnchorPool}
                disabled={creatingPool || !tokenA || !tokenB || !amountA || !amountB || Number(amountA) <= 0 || Number(amountB) <= 0}
                className="w-full h-12 text-base font-semibold"
              >
                {creatingPool ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating Pool...
                  </>
                ) : (
                  "Create Anchor Pool"
                )}
              </Button>
            </div>
          ) : (
            // My Pools List
            <div className="space-y-3">
              {loadingPools ? (
                <div className="text-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
                </div>
              ) : myPools.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>You haven't created any anchor pools yet.</p>
                  <p className="text-sm mt-2">Click "Create Pool" to get started!</p>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Active Pools Grid - matching Base Pool design */}
        {!createMode && myPools.length > 0 && (
          <div className="mt-8">
            <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">Active Anchor Pools</h3>
                <p className="text-sm text-muted-foreground">
                  {showOnlyMyPools
                    ? `${myPools.filter(p => p.userPosition).length} pool${myPools.filter(p => p.userPosition).length !== 1 ? 's' : ''} with your liquidity`
                    : `${myPools.length} pool${myPools.length !== 1 ? 's' : ''} on Silverback`
                  }
                </p>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => {
                    setCreateMode(true);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-brand text-white hover:bg-brand/90 transition-all shadow-sm"
                >
                  + Create Pool
                </button>

                {/* My Pools Filter */}
                {wallet && (
                  <button
                    onClick={() => setShowOnlyMyPools(!showOnlyMyPools)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      showOnlyMyPools
                        ? "bg-brand text-white"
                        : "bg-secondary/60 hover:bg-secondary/80 border border-border/40"
                    }`}
                  >
                    My Pools
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {myPools
                .filter(pool => !showOnlyMyPools || pool.userPosition)
                .map((pool) => {
                // Convert AnchorPool to KeetaPoolCardData format
                const poolCardData: KeetaPoolCardData = {
                  poolAddress: pool.pool_address,
                  tokenA: pool.token_a,
                  tokenB: pool.token_b,
                  symbolA: pool.symbolA || pool.token_a.slice(0, 8),
                  symbolB: pool.symbolB || pool.token_b.slice(0, 8),
                  reserveA: pool.reserveA || '0',
                  reserveB: pool.reserveB || '0',
                  reserveAHuman: pool.reserveAHuman || 0,
                  reserveBHuman: pool.reserveBHuman || 0,
                  decimalsA: pool.decimalsA || 9,
                  decimalsB: pool.decimalsB || 9,
                  totalShares: pool.totalShares || '0',
                  feeBps: pool.fee_bps,
                  userPosition: pool.userPosition,
                };

                return (
                  <KeetaPoolCard
                    key={pool.pool_address}
                    pool={poolCardData}
                    onManage={(selectedPool) => {
                      // Scroll to top and prepare to add more liquidity
                      setCreateMode(false);
                      window.scrollTo({ top: 0, behavior: "smooth" });

                      // Pre-fill the token selection
                      setTokenA(selectedPool.tokenA);
                      setTokenB(selectedPool.tokenB);

                      toast({
                        title: "Add More Liquidity",
                        description: `Adding liquidity to ${selectedPool.symbolA}/${selectedPool.symbolB} pool`,
                      });
                    }}
                    onRemoveLiquidity={async (selectedPool, percent) => {
                      // Remove liquidity from anchor pool
                      if (!wallet) return;

                      try {
                        setRemovingLiq(true);

                        // Calculate LP amount to remove based on percentage
                        const totalShares = BigInt(selectedPool.userPosition?.shares || '0');
                        const sharesToRemove = (totalShares * BigInt(percent)) / 100n;

                        // Call backend to remove liquidity from anchor pool
                        const response = await fetch(`${API_BASE}/anchor-pools/${selectedPool.poolAddress}/remove-liquidity`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            userAddress: wallet.address,
                            lpAmount: sharesToRemove.toString(),
                            amountAMin: '0', // TODO: Add slippage protection
                            amountBMin: '0',
                          }),
                        });

                        const data = await response.json();

                        if (data.success) {
                          toast({
                            title: "Liquidity Removed!",
                            description: `Removed ${percent}% of your liquidity from ${selectedPool.symbolA}/${selectedPool.symbolB}`,
                          });

                          // Reload pools to reflect changes
                          await loadAllPools();
                        } else {
                          throw new Error(data.error || "Failed to remove liquidity");
                        }
                      } catch (error: any) {
                        toast({
                          title: "Remove Liquidity Failed",
                          description: error.message,
                          variant: "destructive",
                        });
                      } finally {
                        setRemovingLiq(false);
                      }
                    }}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Token Selector Modal */}
        <KeetaTokenSelector
          open={selectingToken !== null}
          onClose={() => setSelectingToken(null)}
          onSelect={(token: KeetaToken) => {
            if (selectingToken === "tokenA") {
              setTokenA(token.address);
            } else if (selectingToken === "tokenB") {
              setTokenB(token.address);
            }
            setSelectingToken(null);
          }}
          tokens={selectingToken === "tokenB" ? sortedTokens.filter(t => t.address !== tokenA) : sortedTokens}
          excludeAddress={undefined}
        />
      </div>
    </div>
  );
}
