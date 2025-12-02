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
  Zap,
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

// Swap modes
type SwapMode = "pool" | "anchor";

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
    setSendRecipient,
    sendRecipient,
    sendAmount,
    setSendAmount,
    sending,
    executeSend,
  } = useKeetaWallet();

  // Swap mode toggle
  const [swapMode, setSwapMode] = useState<SwapMode>("pool");

  // Pool swap state
  const [selectedPool, setSelectedPool] = useState<string>("");
  const [swapTokenIn, setSwapTokenIn] = useState<string>("");
  const [swapAmount, setSwapAmount] = useState("");
  const [swapQuote, setSwapQuote] = useState<any>(null);
  const [swapping, setSwapping] = useState(false);
  const [selectingToken, setSelectingToken] = useState<"from" | "to" | null>(null);

  // Anchor swap state
  const [anchorTokenIn, setAnchorTokenIn] = useState<string>("");
  const [anchorTokenOut, setAnchorTokenOut] = useState<string>("");
  const [anchorAmount, setAnchorAmount] = useState("");
  const [anchorQuotes, setAnchorQuotes] = useState<AnchorQuote[]>([]);
  const [selectedAnchorQuote, setSelectedAnchorQuote] = useState<AnchorQuote | null>(null);
  const [anchorLoading, setAnchorLoading] = useState(false);
  const [anchorSwapping, setAnchorSwapping] = useState(false);
  const [selectingAnchorToken, setSelectingAnchorToken] = useState<"from" | "to" | null>(null);

  // Get available pools for current token selection
  const availablePools = useMemo(() => {
    if (!swapTokenIn) return [];
    return (allPools || pools).filter(
      p => p.tokenA === swapTokenIn || p.tokenB === swapTokenIn
    );
  }, [swapTokenIn, pools, allPools]);

  // Get token info (Pool mode)
  const fromTokenInfo = sortedTokens.find((t) => t.address === swapTokenIn);
  const selectedPoolData = (allPools || pools).find(p => p.poolAddress === selectedPool);
  const tokenOutAddress = selectedPoolData
    ? (selectedPoolData.tokenA === swapTokenIn ? selectedPoolData.tokenB : selectedPoolData.tokenA)
    : "";
  const toTokenInfo = sortedTokens.find((t) => t.address === tokenOutAddress);

  // Get token info (Anchor mode)
  const anchorFromTokenInfo = sortedTokens.find((t) => t.address === anchorTokenIn);
  const anchorToTokenInfo = sortedTokens.find((t) => t.address === anchorTokenOut);

  // Toggle tokens
  function toggleTokens() {
    if (selectedPoolData) {
      const newTokenIn = tokenOutAddress;
      setSwapTokenIn(newTokenIn);
      // Pool stays the same, just swap direction
    }
    setSwapQuote(null);
  }

  // Get pool swap quote
  function getQuote() {
    if (!selectedPool || !swapTokenIn || !swapAmount || !selectedPoolData) {
      setSwapQuote(null);
      return;
    }

    try {
      const quote = getPoolQuote(
        swapTokenIn,
        tokenOutAddress,
        swapAmount,
        selectedPool,
        {
          tokenA: selectedPoolData.tokenA,
          tokenB: selectedPoolData.tokenB,
          reserveA: selectedPoolData.reserveA,
          reserveB: selectedPoolData.reserveB,
          decimalsA: selectedPoolData.decimalsA || 9,
          decimalsB: selectedPoolData.decimalsB || 9,
        }
      );

      if (quote) {
        const tokenOutSymbol = selectedPoolData.tokenA === swapTokenIn
          ? selectedPoolData.symbolB
          : selectedPoolData.symbolA;
        const tokenInSymbol = selectedPoolData.tokenA === swapTokenIn
          ? selectedPoolData.symbolA
          : selectedPoolData.symbolB;

        setSwapQuote({
          amountOut: quote.amountOutHuman?.toFixed(6) || "0",
          priceImpact: quote.priceImpact?.toFixed(2) || "0",
          fee: `${quote.feeAmountHuman?.toFixed(6) || "0"} ${tokenInSymbol}`,
          tokenOutSymbol,
          tokenInSymbol,
          amountOutRaw: quote.amountOut,
        });
      } else {
        setSwapQuote(null);
      }
    } catch (error) {
      console.error("Failed to get swap quote:", error);
      setSwapQuote(null);
    }
  }

  // Debounced quote fetching
  useEffect(() => {
    if (swapAmount && selectedPool && swapTokenIn) {
      const timer = setTimeout(() => getQuote(), 200);
      return () => clearTimeout(timer);
    } else {
      setSwapQuote(null);
    }
  }, [swapAmount, selectedPool, swapTokenIn]);

  // Execute pool swap
  async function executeSwap() {
    if (!wallet || !selectedPool || !swapTokenIn || !swapAmount || !swapQuote || !selectedPoolData) return;

    setSwapping(true);
    try {
      const tokenInSymbol = swapQuote.tokenInSymbol;
      const tokenOutSymbol = swapQuote.tokenOutSymbol;

      if (wallet.isKeythings) {
        // Keythings wallet: Two-transaction flow
        const { calculateSwapOutput, calculateFeeSplit, toAtomic } = await import('@/lib/keeta-swap-math');
        const { getKeythingsProvider } = await import('@/lib/keythings-provider');

        const reserveIn = selectedPoolData.tokenA === swapTokenIn
          ? BigInt(selectedPoolData.reserveA)
          : BigInt(selectedPoolData.reserveB);
        const reserveOut = selectedPoolData.tokenA === swapTokenIn
          ? BigInt(selectedPoolData.reserveB)
          : BigInt(selectedPoolData.reserveA);

        const amountInAtomic = toAtomic(swapAmount, 9);
        const { amountOut } = calculateSwapOutput(amountInAtomic, reserveIn, reserveOut);
        const { protocolFee, amountToPool } = calculateFeeSplit(amountInAtomic);

        const provider = getKeythingsProvider();
        if (!provider) throw new Error('Keythings provider not found');

        const userClient = await provider.getUserClient();
        const TREASURY_ADDRESS = 'keeta_aabtozgfunwwvwdztv54y6l5x57q2g3254shgp27zjltr2xz3pyo7q4tjtmsamy';

        // TX1: User sends tokens to pool + treasury
        const tx1Builder = userClient.initBuilder();
        tx1Builder.send(selectedPoolData.poolAddress, amountToPool, swapTokenIn);
        if (protocolFee > 0n) {
          tx1Builder.send(TREASURY_ADDRESS, protocolFee, swapTokenIn);
        }
        await userClient.publishBuilder(tx1Builder);

        // TX2: Backend sends output to user
        const tx2Response = await fetch(`${API_BASE}/swap/keythings/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userAddress: wallet.address,
            poolAddress: selectedPoolData.poolAddress,
            tokenOut: tokenOutAddress,
            amountOut: amountOut.toString(),
          }),
        });

        const tx2Result = await tx2Response.json();
        if (!tx2Result.success) throw new Error(tx2Result.error || 'TX2 failed');

        toast({
          title: "Swap Successful!",
          description: `Swapped ${swapAmount} ${tokenInSymbol} for ${swapQuote.amountOut} ${tokenOutSymbol}`,
        });
      } else {
        // Seed wallet flow
        const swapResponse = await fetch(`${API_BASE}/swap/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userAddress: wallet.address,
            userSeed: wallet.seed,
            tokenIn: swapTokenIn,
            tokenOut: tokenOutAddress,
            amountIn: swapAmount,
            minAmountOut: "0",
            slippagePercent: 0.5,
          }),
        });

        const result = await swapResponse.json();
        if (!result.success) throw new Error(result.error || "Swap failed");

        toast({
          title: "Swap Successful!",
          description: `Swapped ${swapAmount} ${tokenInSymbol} for ${swapQuote.amountOut} ${tokenOutSymbol}`,
        });
      }

      // Clear and refresh
      setSwapAmount("");
      setSwapQuote(null);
      await new Promise(resolve => setTimeout(resolve, 2000));
      await refreshBalances();
      await loadPools();
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

  // Toggle anchor tokens
  function toggleAnchorTokens() {
    const temp = anchorTokenIn;
    setAnchorTokenIn(anchorTokenOut);
    setAnchorTokenOut(temp);
    setAnchorQuotes([]);
    setSelectedAnchorQuote(null);
  }

  // Fetch anchor quotes
  async function fetchAnchorQuotes() {
    if (!wallet || !anchorTokenIn || !anchorTokenOut || !anchorAmount) {
      setAnchorQuotes([]);
      setSelectedAnchorQuote(null);
      return;
    }

    setAnchorLoading(true);
    try {
      const { getKeythingsProvider } = await import('@/lib/keythings-provider');
      const provider = getKeythingsProvider();
      if (!provider) throw new Error('Keythings provider not found');

      const userClient = await provider.getUserClient();
      const decimalsFrom = anchorFromTokenInfo?.decimals || 9;
      const decimalsTo = anchorToTokenInfo?.decimals || 9;

      // Convert to atomic units
      const amountAtomic = BigInt(Math.floor(parseFloat(anchorAmount) * Math.pow(10, decimalsFrom)));

      const quotes = await getAnchorQuotes(
        userClient,
        anchorTokenIn,
        anchorTokenOut,
        amountAtomic,
        decimalsFrom,
        decimalsTo
      );

      setAnchorQuotes(quotes);
      if (quotes.length > 0) {
        setSelectedAnchorQuote(quotes[0]); // Select best quote
      } else {
        setSelectedAnchorQuote(null);
      }
    } catch (error: any) {
      console.error('Failed to fetch anchor quotes:', error);
      setAnchorQuotes([]);
      setSelectedAnchorQuote(null);
    } finally {
      setAnchorLoading(false);
    }
  }

  // Debounced anchor quote fetching
  useEffect(() => {
    if (swapMode === "anchor" && anchorAmount && anchorTokenIn && anchorTokenOut && wallet) {
      const timer = setTimeout(() => fetchAnchorQuotes(), 500);
      return () => clearTimeout(timer);
    } else if (swapMode === "anchor") {
      setAnchorQuotes([]);
      setSelectedAnchorQuote(null);
    }
  }, [anchorAmount, anchorTokenIn, anchorTokenOut, swapMode, wallet]);

  // Execute anchor swap
  async function executeAnchorSwapFn() {
    if (!wallet || !selectedAnchorQuote) return;

    setAnchorSwapping(true);
    try {
      const { getKeythingsProvider } = await import('@/lib/keythings-provider');
      const provider = getKeythingsProvider();
      if (!provider) throw new Error('Keythings provider not found');

      const userClient = await provider.getUserClient();

      const result = await executeAnchorSwap(
        selectedAnchorQuote,
        userClient,
        wallet.address
      );

      if (result.success) {
        toast({
          title: "Swap Successful!",
          description: `Swapped ${anchorAmount} ${anchorFromTokenInfo?.symbol || 'tokens'} via ${selectedAnchorQuote.providerID}`,
        });

        // Clear and refresh
        setAnchorAmount("");
        setAnchorQuotes([]);
        setSelectedAnchorQuote(null);
        await new Promise(resolve => setTimeout(resolve, 2000));
        await refreshBalances();
      }
    } catch (error: any) {
      console.error('Anchor swap failed:', error);
      toast({
        title: "Swap Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setAnchorSwapping(false);
    }
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
                {/* Mode Toggle */}
                <div className="flex rounded-lg bg-secondary/60 p-0.5">
                  <button
                    onClick={() => setSwapMode("pool")}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                      swapMode === "pool"
                        ? "bg-brand text-white shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Pool
                  </button>
                  <button
                    onClick={() => setSwapMode("anchor")}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                      swapMode === "anchor"
                        ? "bg-brand text-white shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Anchor
                  </button>
                </div>
              </div>

              {swapMode === "pool" ? (
                /* Pool Swap Mode */
                <div className="space-y-3">
                  {/* QuickFill */}
                  <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Select a share of your balance</span>
                    <QuickFill
                      balance={fromTokenInfo ? parseFloat(fromTokenInfo.balanceFormatted) : undefined}
                      onSelect={setSwapAmount}
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
                        value={swapAmount}
                        onChange={(e) => setSwapAmount(e.target.value.replace(",", "."))}
                        className="ml-auto flex-1 min-w-0 bg-transparent text-right text-2xl sm:text-3xl font-semibold outline-none placeholder:text-muted-foreground/60"
                      />
                    </div>
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

                  {/* To Token (Pool Selection) */}
                  <div className="rounded-xl border border-border/60 bg-secondary/60 p-4">
                    <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                      <span>You receive</span>
                      {toTokenInfo && <span>Bal: {toTokenInfo.balanceFormatted}</span>}
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setSelectingToken("to")}
                        disabled={!swapTokenIn}
                        className="min-w-24 sm:min-w-28 shrink-0 rounded-lg bg-card hover:bg-card/80 px-3 py-2 flex items-center gap-2 cursor-pointer transition-colors disabled:opacity-50"
                      >
                        {toTokenInfo && <TokenLogo src={getTokenLogo(toTokenInfo.symbol, toTokenInfo.logoUrl)} alt={toTokenInfo.symbol} size={20} />}
                        <span className="text-sm font-semibold">
                          {toTokenInfo ? toTokenInfo.symbol : "Select"}
                        </span>
                      </button>
                      <input
                        readOnly
                        value={swapQuote?.amountOut || "0.00"}
                        className="ml-auto flex-1 min-w-0 bg-transparent text-right text-2xl sm:text-3xl font-semibold outline-none text-muted-foreground/80"
                      />
                    </div>
                  </div>

                  {/* Quote Details */}
                  {swapQuote && (
                    <div className="rounded-lg bg-secondary/40 p-3 space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Expected Output</span>
                        <span className="font-medium">{swapQuote.amountOut} {swapQuote.tokenOutSymbol}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Price Impact</span>
                        <span className={Number(swapQuote.priceImpact) > 5 ? "text-red-400 font-medium" : "font-medium"}>
                          {swapQuote.priceImpact}%
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Fee</span>
                        <span className="font-medium">{swapQuote.fee}</span>
                      </div>
                    </div>
                  )}

                  {/* No pools message */}
                  {swapTokenIn && availablePools.length === 0 && (
                    <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/30 p-3 text-sm text-yellow-400 flex items-center gap-2">
                      <Info className="h-4 w-4 shrink-0" />
                      <span>No pools available for this token.</span>
                    </div>
                  )}

                  <Button
                    onClick={!wallet ? connectKeythingsWallet : executeSwap}
                    disabled={wallet ? (swapping || !swapAmount || !swapTokenIn || !selectedPool || !swapQuote) : loading}
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
              ) : (
                /* Anchor Swap Mode */
                <div className="space-y-3">
                  {/* QuickFill */}
                  <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Select a share of your balance</span>
                    <QuickFill
                      balance={anchorFromTokenInfo ? parseFloat(anchorFromTokenInfo.balanceFormatted) : undefined}
                      onSelect={setAnchorAmount}
                      percents={[25, 50, 75, 100]}
                    />
                  </div>

                  {/* From Token */}
                  <div className="rounded-xl border border-border/60 bg-secondary/60 p-4">
                    <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                      <span>You pay</span>
                      {anchorFromTokenInfo && <span>Bal: {anchorFromTokenInfo.balanceFormatted}</span>}
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setSelectingAnchorToken("from")}
                        className="min-w-24 sm:min-w-28 shrink-0 rounded-lg bg-card hover:bg-card/80 px-3 py-2 flex items-center gap-2 cursor-pointer transition-colors"
                      >
                        {anchorFromTokenInfo && <TokenLogo src={getTokenLogo(anchorFromTokenInfo.symbol, anchorFromTokenInfo.logoUrl)} alt={anchorFromTokenInfo.symbol} size={20} />}
                        <span className="text-sm font-semibold">
                          {anchorFromTokenInfo ? anchorFromTokenInfo.symbol : "Select"}
                        </span>
                      </button>
                      <input
                        inputMode="decimal"
                        pattern="^[0-9]*[.,]?[0-9]*$"
                        placeholder="0.00"
                        value={anchorAmount}
                        onChange={(e) => setAnchorAmount(e.target.value.replace(",", "."))}
                        className="ml-auto flex-1 min-w-0 bg-transparent text-right text-2xl sm:text-3xl font-semibold outline-none placeholder:text-muted-foreground/60"
                      />
                    </div>
                  </div>

                  {/* Swap Arrow */}
                  <div className="relative flex justify-center -my-2">
                    <button
                      type="button"
                      onClick={toggleAnchorTokens}
                      className="rounded-xl border border-border/60 bg-card p-2 shadow-md hover:bg-card/80 transition-colors cursor-pointer z-10"
                    >
                      <ArrowDownUp className="h-4 w-4" />
                    </button>
                  </div>

                  {/* To Token */}
                  <div className="rounded-xl border border-border/60 bg-secondary/60 p-4">
                    <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                      <span>You receive</span>
                      {anchorToTokenInfo && <span>Bal: {anchorToTokenInfo.balanceFormatted}</span>}
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setSelectingAnchorToken("to")}
                        className="min-w-24 sm:min-w-28 shrink-0 rounded-lg bg-card hover:bg-card/80 px-3 py-2 flex items-center gap-2 cursor-pointer transition-colors"
                      >
                        {anchorToTokenInfo && <TokenLogo src={getTokenLogo(anchorToTokenInfo.symbol, anchorToTokenInfo.logoUrl)} alt={anchorToTokenInfo.symbol} size={20} />}
                        <span className="text-sm font-semibold">
                          {anchorToTokenInfo ? anchorToTokenInfo.symbol : "Select"}
                        </span>
                      </button>
                      <input
                        readOnly
                        value={anchorLoading ? "..." : selectedAnchorQuote?.amountOut || "0.00"}
                        className="ml-auto flex-1 min-w-0 bg-transparent text-right text-2xl sm:text-3xl font-semibold outline-none text-muted-foreground/80"
                      />
                    </div>
                  </div>

                  {/* Quote Details */}
                  {selectedAnchorQuote && (
                    <div className="rounded-lg bg-secondary/40 p-3 space-y-2 text-sm">
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Route</span>
                        <span className="font-medium flex items-center gap-1">
                          <Zap className="h-3 w-3 text-sky-400" />
                          {selectedAnchorQuote.providerID}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Expected Output</span>
                        <span className="font-medium">{selectedAnchorQuote.amountOut} {anchorToTokenInfo?.symbol}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Price Impact</span>
                        <span className={Number(selectedAnchorQuote.priceImpact) > 5 ? "text-red-400 font-medium" : "font-medium"}>
                          {selectedAnchorQuote.priceImpact.toFixed(2)}%
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Fee</span>
                        <span className="font-medium">{selectedAnchorQuote.fee} {anchorFromTokenInfo?.symbol}</span>
                      </div>
                      {anchorQuotes.length > 1 && (
                        <div className="pt-1 border-t border-border/40 text-xs text-muted-foreground">
                          {anchorQuotes.length} quotes found - best rate selected
                        </div>
                      )}
                    </div>
                  )}

                  {/* No quotes message */}
                  {anchorTokenIn && anchorTokenOut && anchorAmount && !anchorLoading && anchorQuotes.length === 0 && (
                    <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/30 p-3 text-sm text-yellow-400 flex items-center gap-2">
                      <Info className="h-4 w-4 shrink-0" />
                      <span>No anchor quotes available for this pair.</span>
                    </div>
                  )}

                  <Button
                    onClick={!wallet ? connectKeythingsWallet : executeAnchorSwapFn}
                    disabled={wallet ? (anchorSwapping || anchorLoading || !anchorAmount || !anchorTokenIn || !anchorTokenOut || !selectedAnchorQuote) : loading}
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
                    ) : anchorLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Finding Best Route...
                      </>
                    ) : anchorSwapping ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Swapping...
                      </>
                    ) : (
                      "Swap via Anchor"
                    )}
                  </Button>

                  {/* Resolver info */}
                  <div className="text-xs text-center text-muted-foreground">
                    Using Silverback resolver for FX anchor swaps
                  </div>
                </div>
              )}
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

      {/* Token Selector (Pool Mode) */}
      <KeetaTokenSelector
        open={selectingToken !== null}
        onClose={() => setSelectingToken(null)}
        onSelect={(token: KeetaToken) => {
          if (selectingToken === "from") {
            setSwapTokenIn(token.address);
            setSelectedPool("");
            setSwapQuote(null);
          } else if (selectingToken === "to" && swapTokenIn) {
            // Find pool that connects swapTokenIn to selected token
            const pool = (allPools || pools).find(
              p =>
                (p.tokenA === swapTokenIn && p.tokenB === token.address) ||
                (p.tokenB === swapTokenIn && p.tokenA === token.address)
            );
            if (pool) {
              setSelectedPool(pool.poolAddress);
            }
          }
          setSelectingToken(null);
        }}
        tokens={selectingToken === "from"
          ? sortedTokens
          : selectingToken === "to" && swapTokenIn
            ? (() => {
                // Show only tokens that have pools with swapTokenIn
                const availableOutputTokens = new Set<string>();
                (allPools || pools).forEach(pool => {
                  if (pool.tokenA === swapTokenIn) availableOutputTokens.add(pool.tokenB);
                  if (pool.tokenB === swapTokenIn) availableOutputTokens.add(pool.tokenA);
                });
                return sortedTokens.filter(t => availableOutputTokens.has(t.address));
              })()
            : []
        }
        excludeAddress={swapTokenIn}
      />

      {/* Token Selector (Anchor Mode) */}
      <KeetaTokenSelector
        open={selectingAnchorToken !== null}
        onClose={() => setSelectingAnchorToken(null)}
        onSelect={(token: KeetaToken) => {
          if (selectingAnchorToken === "from") {
            setAnchorTokenIn(token.address);
            setAnchorQuotes([]);
            setSelectedAnchorQuote(null);
          } else if (selectingAnchorToken === "to") {
            setAnchorTokenOut(token.address);
            setAnchorQuotes([]);
            setSelectedAnchorQuote(null);
          }
          setSelectingAnchorToken(null);
        }}
        tokens={sortedTokens}
        excludeAddress={selectingAnchorToken === "from" ? anchorTokenOut : anchorTokenIn}
      />
    </div>
  );
}
