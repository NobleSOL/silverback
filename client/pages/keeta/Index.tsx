import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import {
  Loader2,
  Wallet,
  ArrowRightLeft,
  ArrowDownUp,
  Copy,
  CheckCircle2,
  Info,
  AlertTriangle,
  Send,
} from "lucide-react";
import QuickFill from "@/components/shared/QuickFill";
import TrendingPills from "@/components/shared/TrendingPills";
import { useKeetaWallet } from "@/contexts/KeetaWalletContext";
import {
  getSwapQuote as getSwapQuoteClient,
  executeSwap as executeSwapClient,
} from "@/lib/keeta-client";
import { isKeythingsInstalled } from "@/lib/keythings-provider";

// API base URL
const API_BASE = import.meta.env.VITE_KEETA_API_BASE || `${window.location.origin}/api`;

export default function KeetaIndex() {
  const {
    wallet,
    pools,
    loading,
    keythingsConnected,
    keythingsAddress,
    showAllTokens,
    setShowAllTokens,
    copiedAddress,
    tokenPrices,
    sortedTokens,
    displayedTokens,
    connectKeythingsWallet,
    disconnectWallet,
    refreshBalances,
    loadPools,
    copyToClipboard,
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

  // Swap state
  const [selectedPoolForSwap, setSelectedPoolForSwap] = useState<string>("");
  const [swapTokenIn, setSwapTokenIn] = useState<string>("");
  const [swapAmount, setSwapAmount] = useState("");
  const [swapQuote, setSwapQuote] = useState<any>(null);
  const [swapping, setSwapping] = useState(false);

  // Toggle tokens function for swap
  function toggleSwapTokens() {
    const tempToken = swapTokenIn;
    setSwapTokenIn("");
    setSelectedPoolForSwap("");
    // Note: In current design, we select pool not individual out token
  }

  function getSwapQuote() {
    if (!selectedPoolForSwap || !swapTokenIn || !swapAmount || !wallet) return;

    try {
      const pool = pools.find((p) => p.poolAddress === selectedPoolForSwap);
      if (!pool) return;

      // Determine tokenOut (the opposite token in the pool)
      const tokenOut = pool.tokenA === swapTokenIn ? pool.tokenB : pool.tokenA;
      const tokenInSymbol = pool.tokenA === swapTokenIn ? pool.symbolA : pool.symbolB;
      const tokenOutSymbol = pool.tokenA === swapTokenIn ? pool.symbolB : pool.symbolA;

      // Use client-side swap quote calculation (synchronous, instant!)
      const quote = getSwapQuoteClient(
        swapTokenIn,
        tokenOut,
        swapAmount,
        selectedPoolForSwap,
        {
          tokenA: pool.tokenA,
          tokenB: pool.tokenB,
          reserveA: pool.reserveA,
          reserveB: pool.reserveB,
          decimalsA: pool.decimalsA || 9,
          decimalsB: pool.decimalsB || 9,
        }
      );

      if (quote) {
        setSwapQuote({
          amountOut: quote.amountOutHuman.toFixed(6),
          amountOutHuman: quote.amountOutHuman.toFixed(6),
          priceImpact: quote.priceImpact.toFixed(2),
          minimumReceived: (Number(quote.minimumReceived) / 1e9).toFixed(6),
          feeAmountHuman: `${quote.feeAmountHuman.toFixed(6)} ${tokenInSymbol}`,
          tokenOutSymbol,
        });
      } else {
        setSwapQuote(null);
      }
    } catch (error) {
      console.error("Failed to get swap quote:", error);
      setSwapQuote(null);
    }
  }

  useEffect(() => {
    if (swapAmount && selectedPoolForSwap && swapTokenIn) {
      const timer = setTimeout(() => getSwapQuote(), 200);
      return () => clearTimeout(timer);
    } else {
      setSwapQuote(null);
    }
  }, [swapAmount, selectedPoolForSwap, swapTokenIn]);

  async function executeSwap() {
    if (!wallet || !selectedPoolForSwap || !swapTokenIn || !swapAmount || !swapQuote) return;

    setSwapping(true);
    try {
      const pool = pools.find((p) => p.poolAddress === selectedPoolForSwap);
      if (!pool) {
        throw new Error("Pool not found");
      }

      // Determine tokenOut (the opposite token in the pool)
      const tokenOut = pool.tokenA === swapTokenIn ? pool.tokenB : pool.tokenA;
      const tokenInSymbol = pool.tokenA === swapTokenIn ? pool.symbolA : pool.symbolB;
      const tokenOutSymbol = pool.tokenA === swapTokenIn ? pool.symbolB : pool.symbolA;

      // Keythings wallet: Two-transaction flow
      if (wallet.isKeythings) {
        console.log('🔄 Executing Keythings swap (two-transaction flow)...');

        // Import swap calculation utilities
        const { calculateSwapOutput, calculateFeeSplit, toAtomic } = await import('@/lib/keeta-swap-math');
        const { getKeythingsProvider } = await import('@/lib/keythings-provider');

        // Get pool reserves
        const reserveIn = pool.tokenA === swapTokenIn ? BigInt(pool.reserveA) : BigInt(pool.reserveB);
        const reserveOut = pool.tokenA === swapTokenIn ? BigInt(pool.reserveB) : BigInt(pool.reserveA);

        // Convert input amount to atomic units (assuming 9 decimals)
        const amountInAtomic = toAtomic(swapAmount, 9);

        // Calculate swap output and fees
        const { amountOut, feeAmount, priceImpact } = calculateSwapOutput(
          amountInAtomic,
          reserveIn,
          reserveOut
        );

        console.log('💰 Swap calculation:', {
          amountIn: amountInAtomic.toString(),
          amountOut: amountOut.toString(),
          feeAmount: feeAmount.toString(),
          priceImpact: priceImpact.toFixed(2) + '%',
        });

        // Calculate fee split (0.05% to protocol, 99.95% to pool)
        const { protocolFee, amountToPool } = calculateFeeSplit(amountInAtomic);

        console.log('💸 Fee split:', {
          protocolFee: protocolFee.toString(),
          amountToPool: amountToPool.toString(),
        });

        // Get Keythings user client for transaction signing
        const provider = getKeythingsProvider();
        if (!provider) {
          throw new Error('Keythings provider not found');
        }

        console.log('🔐 Requesting user client from Keythings...');
        const userClient = await provider.getUserClient();

        // Treasury address (hardcoded to match backend)
        const TREASURY_ADDRESS = 'keeta_aabtozgfunwwvwdztv54y6l5x57q2g3254shgp27zjltr2xz3pyo7q4tjtmsamy';

        // Build TX1: User sends tokenIn to pool + treasury
        console.log('📝 Building TX1 (user sends tokens to pool + treasury)...');
        const tx1Builder = userClient.initBuilder();

        // Send 99.95% to pool
        tx1Builder.send(pool.poolAddress, amountToPool, swapTokenIn);

        // Send 0.05% protocol fee to treasury
        if (protocolFee > 0n) {
          tx1Builder.send(TREASURY_ADDRESS, protocolFee, swapTokenIn);
        }

        // Publish TX1 (will prompt user via Keythings UI)
        console.log('✍️ Prompting user to sign TX1 via Keythings...');
        await userClient.publishBuilder(tx1Builder);

        // Extract TX1 block hash for logging
        let tx1Hash = null;
        if (tx1Builder.blocks && tx1Builder.blocks.length > 0) {
          const block = tx1Builder.blocks[0];
          if (block && block.hash) {
            if (typeof block.hash === 'string') {
              tx1Hash = block.hash.toUpperCase();
            } else if (block.hash.toString) {
              const hashStr = block.hash.toString();
              if (hashStr.match(/^[0-9A-Fa-f]+$/)) {
                tx1Hash = hashStr.toUpperCase();
              } else if (block.hash.toString('hex')) {
                tx1Hash = block.hash.toString('hex').toUpperCase();
              }
            }
          }
        }

        console.log(`✅ TX1 completed: ${tx1Hash || 'no hash'}`);

        // Call backend to execute TX2 (pool sends tokenOut to user)
        console.log('📝 Calling backend to execute TX2 (pool → user)...');
        const tx2Response = await fetch(`${API_BASE}/swap/keythings/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userAddress: wallet.address,
            poolAddress: pool.poolAddress,
            tokenOut: tokenOut,
            amountOut: amountOut.toString(),
          }),
        });

        const tx2Result = await tx2Response.json();

        if (!tx2Result.success) {
          throw new Error(tx2Result.error || 'TX2 failed');
        }

        console.log(`✅ TX2 completed: ${tx2Result.result?.blockHash || 'no hash'}`);

        // Build explorer link (use TX2 hash if available, otherwise TX1)
        const blockHash = tx2Result.result?.blockHash || tx1Hash;
        const explorerUrl = blockHash
          ? `https://explorer.test.keeta.com/block/${blockHash}`
          : `https://explorer.test.keeta.com/account/${wallet.address}`;

        toast({
          title: "Swap Successful!",
          description: (
            <div className="space-y-1">
              <div>Swapped {swapAmount} {tokenInSymbol} for {swapQuote.amountOutHuman} {tokenOutSymbol}</div>
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-400 hover:text-sky-300 underline text-sm flex items-center gap-1"
              >
                View on Keeta Explorer
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          ),
        });

        // Clear form
        setSwapAmount("");
        setSwapQuote(null);

        // Wait for blockchain to sync before refreshing
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Refresh wallet balances
        await refreshBalances();

        // Refresh pools to update reserves
        await loadPools();

      } else {
        // Seed wallet: Traditional single-endpoint flow
        console.log('🔄 Executing swap via backend API (requires ops SEND_ON_BEHALF permission)...');

        // Execute swap via backend API (ops account has SEND_ON_BEHALF permission on pool)
        const swapResponse = await fetch(`${API_BASE}/swap/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userAddress: wallet.address,
            userSeed: wallet.seed,
            tokenIn: swapTokenIn,
            tokenOut: tokenOut,
            amountIn: swapAmount,
            minAmountOut: swapQuote.minimumReceived,
            slippagePercent: 0.5,
          }),
        });

        const result = await swapResponse.json();

        console.log('🔍 Swap API result received:', JSON.stringify(result, null, 2));

        if (result.success) {
          // Build explorer link using block hash from result.result.blockHash
          const blockHash = result.result?.blockHash || result.blockHash;
          console.log('🔍 Block hash extracted:', blockHash);

          const explorerUrl = blockHash
            ? `https://explorer.test.keeta.com/block/${blockHash}`
            : `https://explorer.test.keeta.com/account/${wallet.address}`;

          console.log('🔍 Explorer URL built:', explorerUrl);

          toast({
            title: "Swap Successful!",
            description: (
              <div className="space-y-1">
                <div>Swapped {swapAmount} {tokenInSymbol} for {swapQuote.amountOutHuman} {tokenOutSymbol}</div>
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky-400 hover:text-sky-300 underline text-sm flex items-center gap-1"
                >
                  View on Keeta Explorer
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
            ),
          });

          // Clear form
          setSwapAmount("");
          setSwapQuote(null);

          // Wait for blockchain to sync before refreshing
          await new Promise(resolve => setTimeout(resolve, 2000));

          // Refresh wallet balances
          await refreshBalances();

          // Refresh pools to update reserves
          await loadPools();
        } else {
          throw new Error(result.error || "Swap failed");
        }
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

  return (
    <div className="min-h-[calc(100vh-4rem)]">
      <div className="container py-10">
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 md:grid-cols-5">
          {/* Main Section - Swap (Left, 60% width) */}
          <section className="order-1 md:order-1 md:col-span-3">
            <Card className="glass-card-elevated rounded-2xl p-6">
              <div className="mb-4 flex items-center justify-between">
                <h1 className="text-xl font-semibold">Swap</h1>
              </div>
              <div className="space-y-3">
                {/* QuickFill header row */}
                <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Select a share of your balance</span>
                  <QuickFill
                    balance={swapTokenIn && wallet ? parseFloat(wallet.tokens.find(t => t.address === swapTokenIn)?.balanceFormatted || "0") : undefined}
                    onSelect={setSwapAmount}
                    percents={[25, 50, 75, 100]}
                  />
                </div>

                {/* From Token Input */}
                <div className="glass-card rounded-xl p-4">
                  <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>You pay</span>
                    {swapTokenIn && wallet && (
                      <span>
                        Bal: {wallet.tokens.find(t => t.address === swapTokenIn)?.balanceFormatted || "0"}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <select
                      value={swapTokenIn}
                      onChange={(e) => setSwapTokenIn(e.target.value)}
                      className="min-w-24 sm:min-w-28 shrink-0 rounded-lg bg-card hover:bg-card/80 px-3 py-2 text-sm font-semibold border-none outline-none cursor-pointer"
                    >
                      <option value="">Select</option>
                      {wallet?.tokens.map((token) => (
                        <option key={token.address} value={token.address}>
                          {token.symbol}
                        </option>
                      ))}
                    </select>
                    <input
                      inputMode="decimal"
                      pattern="^[0-9]*[.,]?[0-9]*$"
                      placeholder="0.00"
                      value={swapAmount}
                      onChange={(e) => setSwapAmount(e.target.value.replace(",", "."))}
                      className="ml-auto flex-1 min-w-0 bg-transparent text-right text-2xl sm:text-3xl font-semibold outline-none placeholder:text-muted-foreground/60"
                    />
                  </div>
                  {swapTokenIn && swapAmount && tokenPrices?.[swapTokenIn]?.priceUsd && (
                    <div className="text-xs text-muted-foreground text-right mt-1">
                      ${(parseFloat(swapAmount) * tokenPrices[swapTokenIn].priceUsd!).toFixed(2)} USD
                    </div>
                  )}
                </div>

                {/* Swap Arrow - Vertical with toggle */}
                <div className="relative flex justify-center -my-2">
                  <button
                    type="button"
                    onClick={toggleSwapTokens}
                    className="rounded-xl border border-border/60 bg-card p-2 shadow-md hover:bg-card/80 transition-colors cursor-pointer z-10"
                  >
                    <ArrowDownUp className="h-4 w-4" />
                  </button>
                </div>

                {/* To Token Input */}
                <div className="glass-card rounded-xl p-4">
                  <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>You receive</span>
                    {selectedPoolForSwap && wallet && (() => {
                      const pool = pools.find((p) => p.poolAddress === selectedPoolForSwap);
                      if (!pool) return null;
                      const tokenOut = pool.tokenA === swapTokenIn ? pool.tokenB : pool.tokenA;
                      const tokenOutBalance = wallet.tokens.find(t => t.address === tokenOut);
                      return tokenOutBalance ? (
                        <span>
                          Bal: {tokenOutBalance.balanceFormatted}
                        </span>
                      ) : null;
                    })()}
                  </div>
                  <div className="flex items-center gap-3">
                    <select
                      value={selectedPoolForSwap}
                      onChange={(e) => setSelectedPoolForSwap(e.target.value)}
                      disabled={!swapTokenIn}
                      className="min-w-24 sm:min-w-28 shrink-0 rounded-lg bg-card hover:bg-card/80 px-3 py-2 text-sm font-semibold border-none outline-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <option value="">Select</option>
                      {pools
                        .filter(pool =>
                          swapTokenIn && (pool.tokenA === swapTokenIn || pool.tokenB === swapTokenIn)
                        )
                        .map((pool) => {
                          const oppositeSymbol = pool.tokenA === swapTokenIn ? pool.symbolB : pool.symbolA;
                          return (
                            <option key={pool.poolAddress} value={pool.poolAddress}>
                              {oppositeSymbol}
                            </option>
                          );
                        })}
                    </select>
                    <input
                      readOnly
                      value={swapQuote ? swapQuote.amountOutHuman : "0.00"}
                      className="ml-auto flex-1 min-w-0 bg-transparent text-right text-2xl sm:text-3xl font-semibold outline-none text-muted-foreground/80"
                    />
                  </div>
                  {selectedPoolForSwap && swapQuote && (() => {
                    const pool = pools.find((p) => p.poolAddress === selectedPoolForSwap);
                    if (!pool) return null;
                    const tokenOut = pool.tokenA === swapTokenIn ? pool.tokenB : pool.tokenA;
                    const price = tokenPrices?.[tokenOut]?.priceUsd;
                    if (!price) return null;
                    return (
                      <div className="text-xs text-muted-foreground text-right mt-1">
                        ${(parseFloat(swapQuote.amountOutHuman) * price).toFixed(2)} USD
                      </div>
                    );
                  })()}
                </div>

                {/* Quote Details */}
                {swapQuote && (
                  <div className="rounded-lg bg-secondary/40 p-3 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Expected Output</span>
                      <span className="font-medium">{swapQuote.amountOutHuman} {swapQuote.tokenOutSymbol}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Fee</span>
                      <span className="font-medium">{swapQuote.feeAmountHuman}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Price Impact</span>
                      <span className={Number(swapQuote.priceImpact) > 5 ? "text-red-400 font-medium" : "font-medium"}>
                        {swapQuote.priceImpact}%
                      </span>
                    </div>
                  </div>
                )}

                <Button
                  onClick={!wallet ? connectKeythingsWallet : executeSwap}
                  disabled={wallet ? (swapping || !swapAmount || !swapTokenIn || !selectedPoolForSwap) : loading}
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
            </Card>
          </section>

          {/* Sidebar - Trending (Right, 40% width) - Always show, like Base */}
          <aside className="order-2 md:order-2 md:col-span-2 space-y-6">
            {/* Trending on Keeta */}
            <div className="rounded-2xl border border-border/60 bg-card/40 p-5 backdrop-blur">
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
            <DialogDescription>
              Send tokens to another Keeta address
            </DialogDescription>
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
              {sendToken && tokenPrices?.[sendToken.address]?.priceUsd && sendAmount && (
                <div className="text-xs text-muted-foreground">
                  ≈ ${(parseFloat(sendAmount) * tokenPrices[sendToken.address].priceUsd!).toFixed(2)} USD
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSendDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={executeSend}
              disabled={sending || !sendRecipient || !sendAmount}
              className="bg-gradient-to-br from-white/20 to-white/10 hover:from-white/30 hover:to-white/20 border border-white/20 text-white font-semibold crisp-button mono-glow disabled:opacity-50"
            >
              {sending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                "Send"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
