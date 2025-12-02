import React, { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import {
  Loader2,
  Wallet,
  ArrowDownUp,
  Info,
} from "lucide-react";
import QuickFill from "@/components/shared/QuickFill";
import TrendingPills from "@/components/shared/TrendingPills";
import TokenLogo from "@/components/shared/TokenLogo";
import { useKeetaWallet } from "@/contexts/KeetaWalletContext";
import KeetaTokenSelector, { type KeetaToken } from "@/components/keeta/KeetaTokenSelector";
import { getSwapQuote as getPoolQuote } from "@/lib/keeta-client";
import { getAnchorQuotes, executeAnchorSwap, type AnchorQuote } from "@/lib/keeta-anchor";

// KTA logo URL
const KTA_LOGO = "https://raw.githubusercontent.com/keeta-network/brand/main/logo-dark.svg";
const getTokenLogo = (symbol: string, defaultUrl?: string) => {
  if (symbol === "KTA") return KTA_LOGO;
  return defaultUrl;
};

// API base URL
const API_BASE = import.meta.env.VITE_KEETA_API_BASE || `${window.location.origin}/api`;

// Route types
type RouteType = "pool" | "anchor";

interface SwapRoute {
  type: RouteType;
  amountOut: string;
  amountOutHuman: number;
  priceImpact: number;
  fee: string;
  source: string; // e.g., "KTA/WAVE Pool" or "Silverback Anchor"
  // Pool-specific
  poolAddress?: string;
  pool?: any;
  // Anchor-specific
  anchorQuote?: AnchorQuote;
}

export default function KeetaIndex() {
  const {
    wallet,
    pools,
    allPools,
    loading,
    tokenPrices,
    sortedTokens,
    connectKeythingsWallet,
    refreshBalances,
    loadPools,
    sendDialogOpen,
    setSendDialogOpen,
    sendToken,
    setSendToken,
    sendRecipient,
    setSendRecipient,
    sendAmount,
    setSendAmount,
    sending,
    executeSend,
  } = useKeetaWallet();

  // Swap state - token-based (not pool-based)
  const [tokenFrom, setTokenFrom] = useState<string>("");
  const [tokenTo, setTokenTo] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [routes, setRoutes] = useState<SwapRoute[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<SwapRoute | null>(null);
  const [loadingQuotes, setLoadingQuotes] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [selectingToken, setSelectingToken] = useState<"from" | "to" | null>(null);

  // Get token info
  const fromTokenInfo = sortedTokens.find((t) => t.address === tokenFrom);
  const toTokenInfo = sortedTokens.find((t) => t.address === tokenTo);

  // Find pools that connect tokenFrom to tokenTo
  const availablePools = useMemo(() => {
    if (!tokenFrom || !tokenTo) return [];
    return (allPools || pools).filter(
      (p) =>
        (p.tokenA === tokenFrom && p.tokenB === tokenTo) ||
        (p.tokenB === tokenFrom && p.tokenA === tokenTo)
    );
  }, [tokenFrom, tokenTo, pools, allPools]);

  // Toggle tokens
  function toggleTokens() {
    const temp = tokenFrom;
    setTokenFrom(tokenTo);
    setTokenTo(temp);
    setRoutes([]);
    setSelectedRoute(null);
  }

  // Fetch quotes from both pools and anchors
  async function fetchAllQuotes() {
    if (!tokenFrom || !tokenTo || !amount || Number(amount) <= 0) {
      setRoutes([]);
      setSelectedRoute(null);
      return;
    }

    setLoadingQuotes(true);
    const allRoutes: SwapRoute[] = [];

    try {
      const decimalsFrom = fromTokenInfo?.decimals || 9;
      const decimalsTo = toTokenInfo?.decimals || 9;

      // 1. Get pool quotes
      for (const pool of availablePools) {
        try {
          const quote = getPoolQuote(
            tokenFrom,
            tokenTo,
            amount,
            pool.poolAddress,
            {
              tokenA: pool.tokenA,
              tokenB: pool.tokenB,
              reserveA: pool.reserveA,
              reserveB: pool.reserveB,
              decimalsA: pool.decimalsA || 9,
              decimalsB: pool.decimalsB || 9,
            }
          );

          if (quote && quote.amountOutHuman > 0) {
            const tokenOutSymbol = pool.tokenA === tokenFrom ? pool.symbolB : pool.symbolA;
            const tokenInSymbol = pool.tokenA === tokenFrom ? pool.symbolA : pool.symbolB;

            allRoutes.push({
              type: "pool",
              amountOut: quote.amountOut.toString(),
              amountOutHuman: quote.amountOutHuman,
              priceImpact: quote.priceImpact,
              fee: `${quote.feeAmountHuman.toFixed(6)} ${tokenInSymbol}`,
              source: `${pool.symbolA}/${pool.symbolB} Pool`,
              poolAddress: pool.poolAddress,
              pool,
            });
          }
        } catch (err) {
          console.warn(`Failed to get quote from pool ${pool.poolAddress}:`, err);
        }
      }

      // 2. Get anchor quotes (only if wallet connected for signing)
      if (wallet?.isKeythings) {
        try {
          const { getKeythingsProvider } = await import("@/lib/keythings-provider");
          const provider = getKeythingsProvider();

          if (provider) {
            const userClient = await provider.getUserClient();
            const amountAtomic = BigInt(Math.floor(Number(amount) * Math.pow(10, decimalsFrom)));

            const anchorQuotes = await getAnchorQuotes(
              userClient,
              tokenFrom,
              tokenTo,
              amountAtomic,
              decimalsFrom,
              decimalsTo
            );

            for (const aq of anchorQuotes) {
              allRoutes.push({
                type: "anchor",
                amountOut: aq.amountOut.toString(),
                amountOutHuman: aq.amountOutHuman,
                priceImpact: 0, // Anchors don't have price impact
                fee: aq.cost ? `${(Number(aq.cost) / 1e9).toFixed(6)}` : "0",
                source: aq.providerID === "silverback" ? "Silverback Anchor" : `${aq.providerID} Anchor`,
                anchorQuote: aq,
              });
            }
          }
        } catch (err) {
          console.warn("Failed to get anchor quotes:", err);
        }
      }

      // Sort by best output (highest amountOutHuman first)
      allRoutes.sort((a, b) => b.amountOutHuman - a.amountOutHuman);

      setRoutes(allRoutes);

      // Auto-select best route
      if (allRoutes.length > 0) {
        setSelectedRoute(allRoutes[0]);
      } else {
        setSelectedRoute(null);
      }
    } catch (error) {
      console.error("Failed to fetch quotes:", error);
      setRoutes([]);
      setSelectedRoute(null);
    } finally {
      setLoadingQuotes(false);
    }
  }

  // Debounced quote fetching
  useEffect(() => {
    if (amount && tokenFrom && tokenTo) {
      const timer = setTimeout(() => fetchAllQuotes(), 300);
      return () => clearTimeout(timer);
    } else {
      setRoutes([]);
      setSelectedRoute(null);
    }
  }, [amount, tokenFrom, tokenTo, availablePools.length, wallet?.address]);

  // Execute swap based on selected route
  async function executeSwap() {
    if (!wallet || !selectedRoute) return;

    setSwapping(true);
    try {
      if (selectedRoute.type === "pool") {
        await executePoolSwap();
      } else {
        await executeAnchorSwapHandler();
      }
    } catch (error: any) {
      toast({
        title: "Swap Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSwapping(false);
    }
  }

  // Execute pool swap
  async function executePoolSwap() {
    if (!selectedRoute?.pool || !wallet) return;

    const pool = selectedRoute.pool;
    const tokenInSymbol = pool.tokenA === tokenFrom ? pool.symbolA : pool.symbolB;
    const tokenOutSymbol = pool.tokenA === tokenFrom ? pool.symbolB : pool.symbolA;

    if (wallet.isKeythings) {
      // Keythings wallet: Two-transaction flow
      const { calculateSwapOutput, calculateFeeSplit, toAtomic } = await import('@/lib/keeta-swap-math');
      const { getKeythingsProvider } = await import('@/lib/keythings-provider');

      const reserveIn = pool.tokenA === tokenFrom ? BigInt(pool.reserveA) : BigInt(pool.reserveB);
      const reserveOut = pool.tokenA === tokenFrom ? BigInt(pool.reserveB) : BigInt(pool.reserveA);
      const amountInAtomic = toAtomic(amount, 9);
      const { amountOut } = calculateSwapOutput(amountInAtomic, reserveIn, reserveOut);
      const { protocolFee, amountToPool } = calculateFeeSplit(amountInAtomic);

      const provider = getKeythingsProvider();
      if (!provider) throw new Error('Keythings provider not found');

      const userClient = await provider.getUserClient();
      const TREASURY_ADDRESS = 'keeta_aabtozgfunwwvwdztv54y6l5x57q2g3254shgp27zjltr2xz3pyo7q4tjtmsamy';

      // TX1: User sends tokens to pool + treasury
      const tx1Builder = userClient.initBuilder();
      tx1Builder.send(pool.poolAddress, amountToPool, tokenFrom);
      if (protocolFee > 0n) {
        tx1Builder.send(TREASURY_ADDRESS, protocolFee, tokenFrom);
      }
      await userClient.publishBuilder(tx1Builder);

      // TX2: Backend sends output to user
      const tx2Response = await fetch(`${API_BASE}/swap/keythings/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAddress: wallet.address,
          poolAddress: pool.poolAddress,
          tokenOut: tokenTo,
          amountOut: amountOut.toString(),
        }),
      });

      const tx2Result = await tx2Response.json();
      if (!tx2Result.success) throw new Error(tx2Result.error || 'TX2 failed');

      toast({
        title: "Swap Successful!",
        description: `Swapped ${amount} ${tokenInSymbol} for ${selectedRoute.amountOutHuman.toFixed(6)} ${tokenOutSymbol} via Pool`,
      });
    } else {
      // Seed wallet flow
      const swapResponse = await fetch(`${API_BASE}/swap/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAddress: wallet.address,
          userSeed: wallet.seed,
          tokenIn: tokenFrom,
          tokenOut: tokenTo,
          amountIn: amount,
          minAmountOut: "0",
          slippagePercent: 0.5,
        }),
      });

      const result = await swapResponse.json();
      if (!result.success) throw new Error(result.error || "Swap failed");

      toast({
        title: "Swap Successful!",
        description: `Swapped ${amount} ${tokenInSymbol} for ${selectedRoute.amountOutHuman.toFixed(6)} ${tokenOutSymbol} via Pool`,
      });
    }

    // Clear and refresh
    setAmount("");
    setRoutes([]);
    setSelectedRoute(null);
    await new Promise(resolve => setTimeout(resolve, 2000));
    await refreshBalances();
    await loadPools();
  }

  // Execute anchor swap
  async function executeAnchorSwapHandler() {
    if (!selectedRoute?.anchorQuote || !wallet) return;

    const { getKeythingsProvider } = await import("@/lib/keythings-provider");
    const provider = getKeythingsProvider();
    if (!provider) throw new Error("Keythings provider not found");

    const userClient = await provider.getUserClient();
    await executeAnchorSwap(selectedRoute.anchorQuote, userClient, wallet.address);

    toast({
      title: "Swap Successful!",
      description: `Swapped via ${selectedRoute.source}`,
    });

    setAmount("");
    setRoutes([]);
    setSelectedRoute(null);
    await refreshBalances();
  }

  return (
    <div className="min-h-[calc(100vh-4rem)]">
      <div className="container py-10">
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 md:grid-cols-5">
          {/* Main Section - Swap */}
          <section className="order-1 md:order-1 md:col-span-3">
            <div className="glass-card-elevated rounded-2xl p-6">
              <div className="mb-4 flex items-center justify-between">
                <h1 className="text-xl font-semibold">Swap</h1>
                {routes.length > 1 && (
                  <span className="text-xs text-muted-foreground">
                    {routes.length} routes found
                  </span>
                )}
              </div>

              <div className="space-y-3">
                {/* QuickFill */}
                <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Select a share of your balance</span>
                  <QuickFill
                    balance={fromTokenInfo ? parseFloat(fromTokenInfo.balanceFormatted) : undefined}
                    onSelect={setAmount}
                    percents={[25, 50, 75, 100]}
                  />
                </div>

                {/* From Token */}
                <div className="rounded-xl border border-border/60 bg-secondary/60 p-4">
                  <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>You pay</span>
                    {fromTokenInfo && <span>Bal: {fromTokenInfo.balanceFormatted}</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectingToken("from")}
                      className="min-w-24 sm:min-w-28 shrink-0 rounded-lg bg-card hover:bg-card/80 px-3 py-2 flex items-center gap-2 cursor-pointer transition-colors"
                    >
                      {fromTokenInfo && <TokenLogo src={getTokenLogo(fromTokenInfo.symbol, fromTokenInfo.logoUrl)} alt={fromTokenInfo.symbol} size={20} />}
                      <span className="text-sm font-semibold">
                        {fromTokenInfo ? fromTokenInfo.symbol : "Select"}
                      </span>
                    </button>
                    <input
                      inputMode="decimal"
                      pattern="^[0-9]*[.,]?[0-9]*$"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value.replace(",", "."))}
                      className="ml-auto flex-1 min-w-0 bg-transparent text-right text-2xl sm:text-3xl font-semibold outline-none placeholder:text-muted-foreground/60"
                    />
                  </div>
                  {tokenFrom && amount && tokenPrices?.[tokenFrom]?.priceUsd && (
                    <div className="text-xs text-muted-foreground text-right mt-1">
                      ${(parseFloat(amount) * tokenPrices[tokenFrom].priceUsd!).toFixed(2)} USD
                    </div>
                  )}
                </div>

                {/* Swap Arrow */}
                <div className="relative flex justify-center -my-2">
                  <button
                    type="button"
                    onClick={toggleTokens}
                    className="rounded-xl border border-border/60 bg-card p-2 shadow-md hover:bg-card/80 transition-colors cursor-pointer z-10"
                  >
                    <ArrowDownUp className="h-4 w-4" />
                  </button>
                </div>

                {/* To Token */}
                <div className="rounded-xl border border-border/60 bg-secondary/60 p-4">
                  <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>You receive</span>
                    {toTokenInfo && <span>Bal: {toTokenInfo.balanceFormatted}</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectingToken("to")}
                      className="min-w-24 sm:min-w-28 shrink-0 rounded-lg bg-card hover:bg-card/80 px-3 py-2 flex items-center gap-2 cursor-pointer transition-colors"
                    >
                      {toTokenInfo && <TokenLogo src={getTokenLogo(toTokenInfo.symbol, toTokenInfo.logoUrl)} alt={toTokenInfo.symbol} size={20} />}
                      <span className="text-sm font-semibold">
                        {toTokenInfo ? toTokenInfo.symbol : "Select"}
                      </span>
                    </button>
                    <input
                      readOnly
                      value={selectedRoute ? selectedRoute.amountOutHuman.toFixed(6) : "0.00"}
                      className="ml-auto flex-1 min-w-0 bg-transparent text-right text-2xl sm:text-3xl font-semibold outline-none text-muted-foreground/80"
                    />
                  </div>
                  {tokenTo && selectedRoute && tokenPrices?.[tokenTo]?.priceUsd && (
                    <div className="text-xs text-muted-foreground text-right mt-1">
                      ${(selectedRoute.amountOutHuman * tokenPrices[tokenTo].priceUsd!).toFixed(2)} USD
                    </div>
                  )}
                </div>

                {/* Loading indicator */}
                {loadingQuotes && (
                  <div className="flex items-center justify-center py-2">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    <span className="text-sm text-muted-foreground">Finding best route...</span>
                  </div>
                )}

                {/* Route Details */}
                {selectedRoute && !loadingQuotes && (
                  <div className="rounded-lg bg-secondary/40 p-3 space-y-2 text-sm">
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Route</span>
                      <span className="font-medium flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${selectedRoute.type === "pool" ? "bg-purple-400" : "bg-sky-400"}`} />
                        {selectedRoute.source}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Expected Output</span>
                      <span className="font-medium">{selectedRoute.amountOutHuman.toFixed(6)} {toTokenInfo?.symbol}</span>
                    </div>
                    {selectedRoute.type === "pool" && selectedRoute.priceImpact > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Price Impact</span>
                        <span className={selectedRoute.priceImpact > 5 ? "text-red-400 font-medium" : "font-medium"}>
                          {selectedRoute.priceImpact.toFixed(2)}%
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Fee</span>
                      <span className="font-medium">{selectedRoute.fee}</span>
                    </div>

                    {/* Route selection if multiple routes */}
                    {routes.length > 1 && (
                      <div className="pt-2 border-t border-border/40 mt-2">
                        <div className="text-xs text-muted-foreground mb-2">Available routes:</div>
                        <div className="space-y-1">
                          {routes.map((route, i) => (
                            <button
                              key={i}
                              onClick={() => setSelectedRoute(route)}
                              className={`w-full text-left px-2 py-1.5 rounded text-xs flex justify-between items-center transition-colors ${
                                selectedRoute === route
                                  ? "bg-brand/20 border border-brand/40"
                                  : "bg-secondary/60 hover:bg-secondary/80"
                              }`}
                            >
                              <span className="flex items-center gap-1.5">
                                <span className={`w-1.5 h-1.5 rounded-full ${route.type === "pool" ? "bg-purple-400" : "bg-sky-400"}`} />
                                {route.source}
                              </span>
                              <span className="font-mono">{route.amountOutHuman.toFixed(4)}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* No routes message */}
                {!loadingQuotes && tokenFrom && tokenTo && amount && Number(amount) > 0 && routes.length === 0 && (
                  <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/30 p-3 text-sm text-yellow-400 flex items-center gap-2">
                    <Info className="h-4 w-4 shrink-0" />
                    <span>No routes available for this pair. Try a different token.</span>
                  </div>
                )}

                <Button
                  onClick={!wallet ? connectKeythingsWallet : executeSwap}
                  disabled={wallet ? (swapping || !amount || !tokenFrom || !tokenTo || !selectedRoute || loadingQuotes) : loading}
                  className="w-full h-12 text-base font-semibold"
                >
                  {!wallet ? (
                    loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Connecting...
                      </>
                    ) : (
                      <>
                        <Wallet className="mr-2 h-4 w-4" />
                        Connect Wallet
                      </>
                    )
                  ) : swapping ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Swapping...
                    </>
                  ) : (
                    "Swap"
                  )}
                </Button>
              </div>
            </div>
          </section>

          {/* Sidebar - Trending */}
          <aside className="order-2 md:order-2 md:col-span-2 space-y-6">
            <div className="glass-card rounded-2xl p-5">
              <TrendingPills symbols={["KTA", "BACK", "KBTC"]} title="Trending on Keeta" />
            </div>
          </aside>
        </div>
      </div>

      {/* Send Tokens Dialog */}
      <Dialog open={sendDialogOpen} onOpenChange={setSendDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send {sendToken?.symbol}</DialogTitle>
            <DialogDescription>Send tokens to another Keeta address</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Recipient Address</label>
              <Input
                placeholder="keeta_a..."
                value={sendRecipient}
                onChange={(e) => setSendRecipient(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Amount
                {sendToken && (
                  <span className="text-muted-foreground font-normal ml-2">
                    (Balance: {sendToken.balanceFormatted} {sendToken.symbol})
                  </span>
                )}
              </label>
              <Input
                type="number"
                placeholder="0.0"
                value={sendAmount}
                onChange={(e) => setSendAmount(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendDialogOpen(false)}>Cancel</Button>
            <Button onClick={executeSend} disabled={sending || !sendRecipient || !sendAmount}>
              {sending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending...</> : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Token Selector */}
      <KeetaTokenSelector
        open={selectingToken !== null}
        onClose={() => setSelectingToken(null)}
        onSelect={(token: KeetaToken) => {
          if (selectingToken === "from") {
            setTokenFrom(token.address);
            if (token.address === tokenTo) setTokenTo("");
          } else {
            setTokenTo(token.address);
            if (token.address === tokenFrom) setTokenFrom("");
          }
          setSelectingToken(null);
        }}
        tokens={sortedTokens}
        excludeAddress={selectingToken === "from" ? tokenTo : tokenFrom}
      />
    </div>
  );
}
