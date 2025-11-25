import React, { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import {
  Loader2,
  Wallet,
  Plus,
  ArrowDownUp,
  Settings,
  Pause,
  Play,
  TrendingUp,
} from "lucide-react";
import { useKeetaWallet } from "@/contexts/KeetaWalletContext";
import KeetaTokenSelector, { type KeetaToken } from "@/components/keeta/KeetaTokenSelector";
import TokenLogo from "@/components/shared/TokenLogo";

// API base URL
const API_BASE = import.meta.env.VITE_KEETA_API_BASE || `${window.location.origin}/api`;

// KTA logo URL
const KTA_LOGO = "https://raw.githubusercontent.com/keeta-network/brand/main/logo-dark.svg";

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
  status: 'active' | 'paused' | 'closed';
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
  const [creatingPool, setCreatingPool] = useState(false);
  const [selectingToken, setSelectingToken] = useState<"tokenA" | "tokenB" | null>(null);

  // Update pool state
  const [updatingPool, setUpdatingPool] = useState<string | null>(null);
  const [updatingFee, setUpdatingFee] = useState<{ poolAddress: string; fee: number } | null>(null);

  // Load user's anchor pools
  async function loadMyPools() {
    if (!wallet) return;

    setLoadingPools(true);
    try {
      const response = await fetch(`${API_BASE}/anchor-pools/creator/${wallet.address}`);
      const data = await response.json();

      if (data.success) {
        setMyPools(data.pools);
      }
    } catch (error: any) {
      console.error('Failed to load anchor pools:', error);
    } finally {
      setLoadingPools(false);
    }
  }

  useEffect(() => {
    loadMyPools();
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

      // Step 2: Add liquidity (user sends tokens to pool)
      const { createKeetaClientFromSeed } = await import("@/lib/keeta-client");
      const { lib } = await import("@keetanetwork/anchor");
      const userClient = createKeetaClientFromSeed(wallet.seed, wallet.accountIndex || 0);

      const poolAccount = lib.Account.fromPublicKeyString(pool.poolAddress);
      const tokenAAccount = lib.Account.fromPublicKeyString(tokenA);
      const tokenBAccount = lib.Account.fromPublicKeyString(tokenB);

      // Get token decimals
      const tokenAInfo = sortedTokens.find(t => t.address === tokenA);
      const tokenBInfo = sortedTokens.find(t => t.address === tokenB);
      const decimalsA = tokenAInfo?.decimals || 9;
      const decimalsB = tokenBInfo?.decimals || 9;

      // Convert amounts to atomic units
      const amountABigInt = BigInt(Math.floor(Number(amountA) * Math.pow(10, decimalsA)));
      const amountBBigInt = BigInt(Math.floor(Number(amountB) * Math.pow(10, decimalsB)));

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

      // Step 3: Request backend to mint LP tokens
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
      setCreateMode(false);

      // Reload pools
      await loadMyPools();
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

  async function updatePoolStatus(poolAddress: string, status: 'active' | 'paused') {
    if (!wallet) return;

    setUpdatingPool(poolAddress);
    try {
      const response = await fetch(`${API_BASE}/anchor-pools/${poolAddress}/update-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorAddress: wallet.address,
          status,
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast({
          title: "Pool Updated",
          description: `Pool ${status === 'active' ? 'activated' : 'paused'}`,
        });

        await loadMyPools();
      } else {
        throw new Error(data.error || "Failed to update pool");
      }
    } catch (error: any) {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setUpdatingPool(null);
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

        await loadMyPools();
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
        totalVolume24h: "$0.00",
        totalFees24h: "$0.00",
      };
    }

    const activePools = myPools.filter(p => p.status === 'active').length;
    const totalVolume = myPools.reduce((sum, p) => sum + parseFloat(p.volume24h || '0'), 0);
    const totalFees = myPools.reduce((sum, p) => sum + parseFloat(p.feesCollected24h || '0'), 0);

    return {
      totalPools: myPools.length,
      activePools,
      totalVolume24h: `$${totalVolume.toFixed(2)}`,
      totalFees24h: `$${totalFees.toFixed(2)}`,
    };
  }, [myPools]);

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[radial-gradient(100%_60%_at_0%_0%,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0)_60%),radial-gradient(80%_50%_at_100%_100%,rgba(255,255,255,0.04)_0%,rgba(255,255,255,0)_50%)]">
      <div className="container py-8 sm:py-10">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold mb-2">My FX Anchors</h1>
          <p className="text-muted-foreground text-sm">
            Create and manage your own FX anchor pools to earn trading fees
          </p>
        </div>

        {/* Stats Dashboard */}
        {wallet && myPools.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="glass-card-elevated rounded-xl p-4">
              <div className="text-xs text-muted-foreground mb-1">Total Pools</div>
              <div className="text-2xl font-bold">{stats.totalPools}</div>
            </div>
            <div className="glass-card-elevated rounded-xl p-4">
              <div className="text-xs text-muted-foreground mb-1">Active</div>
              <div className="text-2xl font-bold text-green-400">{stats.activePools}</div>
            </div>
            <div className="glass-card-elevated rounded-xl p-4">
              <div className="text-xs text-muted-foreground mb-1">24h Volume</div>
              <div className="text-2xl font-bold">{stats.totalVolume24h}</div>
            </div>
            <div className="glass-card-elevated rounded-xl p-4">
              <div className="text-xs text-muted-foreground mb-1">24h Fees Earned</div>
              <div className="text-2xl font-bold text-sky-400">{stats.totalFees24h}</div>
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
                    type="number"
                    min="1"
                    max="1000"
                    step="1"
                    value={feeBps}
                    onChange={(e) => setFeeBps(Math.max(1, Math.min(1000, parseInt(e.target.value) || 30)))}
                    className="flex-1 rounded-lg bg-card px-3 py-2 text-sm font-semibold outline-none"
                  />
                  <span className="text-sm text-muted-foreground">
                    bps ({(feeBps / 100).toFixed(2)}%)
                  </span>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  1-1000 basis points (0.01% - 10%). Lower fees attract more volume!
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
              ) : (
                myPools.map((pool) => {
                  // Use metadata from backend API (symbolA, symbolB, iconA, iconB)
                  const symbolA = pool.symbolA || pool.token_a.slice(0, 8);
                  const symbolB = pool.symbolB || pool.token_b.slice(0, 8);
                  const iconA = pool.iconA || getTokenLogo(symbolA);

                  return (
                    <div key={pool.pool_address} className="glass-card rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <TokenLogo src={iconA} alt={symbolA} size={24} />
                          <span className="font-semibold">
                            {symbolA} / {symbolB}
                          </span>
                          <span className={`text-xs px-2 py-1 rounded-full ${
                            pool.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
                          }`}>
                            {pool.status}
                          </span>
                        </div>
                        <button
                          onClick={() => updatePoolStatus(pool.pool_address, pool.status === 'active' ? 'paused' : 'active')}
                          disabled={updatingPool === pool.pool_address}
                          className="p-2 rounded-lg hover:bg-secondary/60 transition-colors disabled:opacity-50"
                        >
                          {updatingPool === pool.pool_address ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : pool.status === 'active' ? (
                            <Pause className="h-4 w-4" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                        </button>
                      </div>

                      <div className="grid grid-cols-3 gap-3 text-sm">
                        <div>
                          <div className="text-xs text-muted-foreground">Fee</div>
                          <div className="font-medium">{(pool.fee_bps / 100).toFixed(2)}%</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">24h Swaps</div>
                          <div className="font-medium">{pool.swapCount24h || 0}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">24h Fees</div>
                          <div className="font-medium text-sky-400">
                            ${parseFloat(pool.feesCollected24h || '0').toFixed(2)}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

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
