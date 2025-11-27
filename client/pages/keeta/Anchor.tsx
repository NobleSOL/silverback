import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import {
  Loader2,
  ArrowRightLeft,
  ArrowDownUp,
  Info,
} from "lucide-react";
import { useKeetaWallet } from "@/contexts/KeetaWalletContext";
import { getAnchorQuotes, executeAnchorSwap, type AnchorQuote } from "@/lib/keeta-anchor";
import QuickFill from "@/components/shared/QuickFill";
import TokenLogo from "@/components/shared/TokenLogo";
import KeetaTokenSelector, { type KeetaToken } from "@/components/keeta/KeetaTokenSelector";

// KTA logo URL (using Keeta logo)
const KTA_LOGO = "https://raw.githubusercontent.com/keeta-network/brand/main/logo-dark.svg";

// Helper to get token logo
const getTokenLogo = (symbol: string, defaultUrl?: string) => {
  if (symbol === "KTA") return KTA_LOGO;
  return defaultUrl;
};

export default function KeetaAnchor() {
  const { wallet, sortedTokens, tokenPrices, connectKeythingsWallet, loading } = useKeetaWallet();

  // Debug logging
  useEffect(() => {
    console.log('🔍 Anchor Page - Wallet:', wallet ? 'Connected' : 'Not connected');
    console.log('🔍 Anchor Page - Tokens:', sortedTokens?.length || 0);
    console.log('🔍 Anchor Page - Token list:', sortedTokens);
  }, [wallet, sortedTokens]);

  // Anchor swap state
  const [tokenFrom, setTokenFrom] = useState<string>("");
  const [tokenTo, setTokenTo] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [anchorQuotes, setAnchorQuotes] = useState<AnchorQuote[]>([]);
  const [selectedQuote, setSelectedQuote] = useState<AnchorQuote | null>(null);
  const [loadingQuotes, setLoadingQuotes] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [selectingToken, setSelectingToken] = useState<"from" | "to" | null>(null);

  // Toggle tokens
  function toggleTokens() {
    const temp = tokenFrom;
    setTokenFrom(tokenTo);
    setTokenTo(temp);
    setAnchorQuotes([]);
    setSelectedQuote(null);
  }

  // Get token info
  const fromTokenInfo = sortedTokens.find((t) => t.address === tokenFrom);
  const toTokenInfo = sortedTokens.find((t) => t.address === tokenTo);

  // Fetch anchor quotes
  async function fetchAnchorQuotes() {
    if (!wallet || !tokenFrom || !tokenTo || !amount || Number(amount) <= 0) {
      setAnchorQuotes([]);
      setSelectedQuote(null);
      return;
    }

    setLoadingQuotes(true);
    try {
      // Import Keythings provider helper
      const { getKeythingsProvider } = await import("@/lib/keythings-provider");

      // Get user client from Keythings provider
      const provider = getKeythingsProvider();
      if (!provider) {
        throw new Error("Keythings provider not found");
      }

      const userClient = await provider.getUserClient();

      // Convert amount to atomic units
      const decimalsFrom = fromTokenInfo?.decimals || 9;
      const amountAtomic = BigInt(Math.floor(Number(amount) * Math.pow(10, decimalsFrom)));

      console.log("🔍 Fetching anchor quotes...");
      const quotes = await getAnchorQuotes(
        userClient,
        tokenFrom,
        tokenTo,
        amountAtomic,
        decimalsFrom,
        toTokenInfo?.decimals || 9
      );

      setAnchorQuotes(quotes);
      if (quotes.length > 0) {
        // Auto-select best quote (first one, as they're sorted)
        setSelectedQuote(quotes[0]);
        console.log(`✅ Received ${quotes.length} quote(s)`);
      } else {
        setSelectedQuote(null);
        toast({
          title: "No quotes available",
          description: "No anchor providers found for this trading pair.",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error("Failed to fetch anchor quotes:", error);
      setAnchorQuotes([]);
      setSelectedQuote(null);
      toast({
        title: "Quote fetch failed",
        description: error.message || "Failed to get anchor quotes",
        variant: "destructive",
      });
    } finally {
      setLoadingQuotes(false);
    }
  }

  // Auto-fetch quotes when inputs change
  useEffect(() => {
    if (amount && tokenFrom && tokenTo) {
      const timer = setTimeout(() => fetchAnchorQuotes(), 500);
      return () => clearTimeout(timer);
    } else {
      setAnchorQuotes([]);
      setSelectedQuote(null);
    }
  }, [amount, tokenFrom, tokenTo]);

  // Execute anchor swap
  async function handleExecuteSwap() {
    if (!selectedQuote || !wallet) return;

    setExecuting(true);
    try {
      // Import Keythings provider helper
      const { getKeythingsProvider } = await import("@/lib/keythings-provider");

      // Get user client from Keythings provider (same pattern as Index.tsx)
      const provider = getKeythingsProvider();
      if (!provider) {
        throw new Error("Keythings provider not found");
      }

      const userClient = await provider.getUserClient();

      // Execute swap with user client and address
      const result = await executeAnchorSwap(selectedQuote, userClient, wallet.address);

      toast({
        title: "Swap executed!",
        description: `Provider: ${selectedQuote.providerID}`,
      });

      // Reset form
      setAmount("");
      setAnchorQuotes([]);
      setSelectedQuote(null);
    } catch (error: any) {
      console.error("❌ Swap execution failed:", error);
      toast({
        title: "Swap failed",
        description: error.message || "Failed to execute anchor swap",
        variant: "destructive",
      });
    } finally {
      setExecuting(false);
    }
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[radial-gradient(100%_60%_at_0%_0%,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0)_60%),radial-gradient(80%_50%_at_100%_100%,rgba(255,255,255,0.04)_0%,rgba(255,255,255,0)_50%)]">
      <div className="container py-8 sm:py-10">
        <div className="mx-auto max-w-xl">
          {!wallet ? (
            <div className="glass-card-elevated rounded-2xl p-6 sm:p-8 text-center space-y-6">
              <div>
                <h2 className="text-2xl font-bold mb-2">Anchor Trading</h2>
                <p className="text-muted-foreground">
                  Connect your Keeta wallet to trade via FX anchors
                </p>
              </div>
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
                  "Connect Keythings Wallet"
                )}
              </Button>
            </div>
          ) : (
            <div className="glass-card-elevated rounded-2xl p-4 sm:p-6">
              <div className="mb-4">
                <h1 className="text-xl font-semibold">Anchor Swap</h1>
              </div>
              <div className="space-y-3">
                {/* QuickFill header row */}
                <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Select a share of your balance</span>
                  <QuickFill
                    balance={tokenFrom && fromTokenInfo ? parseFloat(fromTokenInfo.balanceFormatted) : undefined}
                    onSelect={setAmount}
                    percents={[25, 50, 75, 100]}
                  />
                </div>

                {/* From Token Input */}
                <div className="rounded-xl border border-border/60 bg-secondary/60 p-4">
                  <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>You pay</span>
                    {tokenFrom && fromTokenInfo && (
                      <span>
                        Bal: {fromTokenInfo.balanceFormatted}
                      </span>
                    )}
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

                {/* Swap Arrow - Vertical with toggle */}
                <div className="relative flex justify-center -my-2">
                  <button
                    type="button"
                    onClick={toggleTokens}
                    disabled={!tokenFrom || !tokenTo}
                    className="rounded-xl border border-border/60 bg-card p-2 shadow-md hover:bg-card/80 transition-colors cursor-pointer z-10 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ArrowDownUp className="h-4 w-4" />
                  </button>
                </div>

                {/* To Token Input */}
                <div className="rounded-xl border border-border/60 bg-secondary/60 p-4">
                  <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>You receive</span>
                    {tokenTo && toTokenInfo && (
                      <span>
                        Bal: {toTokenInfo.balanceFormatted}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectingToken("to")}
                      disabled={!tokenFrom}
                      className="min-w-24 sm:min-w-28 shrink-0 rounded-lg bg-card hover:bg-card/80 px-3 py-2 flex items-center gap-2 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {toTokenInfo && <TokenLogo src={getTokenLogo(toTokenInfo.symbol, toTokenInfo.logoUrl)} alt={toTokenInfo.symbol} size={20} />}
                      <span className="text-sm font-semibold">
                        {toTokenInfo ? toTokenInfo.symbol : "Select"}
                      </span>
                    </button>
                    <input
                      readOnly
                      value={selectedQuote ? selectedQuote.amountOut : "0.00"}
                      className="ml-auto flex-1 min-w-0 bg-transparent text-right text-2xl sm:text-3xl font-semibold outline-none text-muted-foreground/80"
                    />
                  </div>
                  {tokenTo && selectedQuote && tokenPrices?.[tokenTo]?.priceUsd && (
                    <div className="text-xs text-muted-foreground text-right mt-1">
                      ${(parseFloat(selectedQuote.amountOut) * tokenPrices[tokenTo].priceUsd!).toFixed(2)} USD
                    </div>
                  )}
                </div>

                {/* Quote Details */}
                {selectedQuote && (
                  <div className="glass-card rounded-xl p-4 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Price Impact</span>
                      <span
                        className={
                          selectedQuote.priceImpact < 1
                            ? "text-green-400"
                            : selectedQuote.priceImpact < 3
                            ? "text-yellow-400"
                            : "text-red-400"
                        }
                      >
                        {selectedQuote.priceImpact.toFixed(2)}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Fee</span>
                      <span>{selectedQuote.fee} {fromTokenInfo?.symbol}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Provider</span>
                      <span className={selectedQuote.providerID === 'Silverback' ? 'text-orange-400 font-medium' : 'text-sky-400 font-medium'}>
                        {selectedQuote.providerID}
                      </span>
                    </div>
                  </div>
                )}

                {/* Execute Button */}
                <Button
                  onClick={handleExecuteSwap}
                  disabled={!selectedQuote || executing || loadingQuotes}
                  className="w-full h-12 text-base font-semibold"
                  size="lg"
                >
                  {executing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Executing Swap...
                    </>
                  ) : loadingQuotes ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Getting Quotes...
                    </>
                  ) : selectedQuote ? (
                    <>
                      <ArrowRightLeft className="mr-2 h-4 w-4" />
                      Swap via Anchor
                    </>
                  ) : (
                    "Enter amount to get quote"
                  )}
                </Button>

                {/* Info Notice */}
                <div className="glass-card rounded-xl p-3 text-xs text-muted-foreground">
                  <div className="flex items-start gap-2">
                    <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
                    <p>
                      FX Anchors provide competitive rates and deep liquidity by connecting to
                      multiple providers. Quotes are fetched in real-time from mainnet.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Token Selector Modal */}
        <KeetaTokenSelector
          open={selectingToken !== null}
          onClose={() => setSelectingToken(null)}
          onSelect={(token: KeetaToken) => {
            if (selectingToken === "from") {
              setTokenFrom(token.address);
            } else if (selectingToken === "to") {
              setTokenTo(token.address);
            }
            setSelectingToken(null);
          }}
          tokens={sortedTokens}
          excludeAddress={selectingToken === "to" ? tokenFrom : undefined}
        />
      </div>
    </div>
  );
}
