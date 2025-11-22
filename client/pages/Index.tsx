import React, { useEffect, useMemo, useState } from "react";
import TokenInput, { Token } from "@/components/swap/TokenInput";
import TokenSelector from "@/components/swap/TokenSelector";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { TransactionHistory, Transaction } from "@/components/swap/TransactionHistory";
import { ArrowDownUp } from "lucide-react";
import TrendingPills from "@/components/shared/TrendingPills";
import QuickFill from "@/components/shared/QuickFill";
import { tokenBySymbol, TOKEN_META } from "@/lib/tokens";
import { useAccount, useConnect, usePublicClient, useWriteContract, useSendTransaction, useSwitchChain, useChainId } from "wagmi";
import { useTokenList } from "@/hooks/useTokenList";
import { toWei, fromWei } from "@/aggregator/openocean";
import { getBestAggregatedQuote } from "@/aggregator/engine";
import { ERC20_ABI } from "@/lib/erc20";
import { formatUnits } from "viem";
import { base } from "viem/chains";
import { executeSwapViaOpenOcean, executeSwapViaSilverbackV2, executeSwapDirectlyViaOpenOcean, unifiedRouterAddress } from "@/aggregator/execute";
import { toast } from "@/hooks/use-toast";
import { useDexscreenerTokenStats } from "@/hooks/useDexscreener";
import { formatUSD } from "@/lib/pricing";

const TOKENS: Token[] = ["ETH", "USDC", "SBCK", "WBTC", "KTA"].map((sym) => ({
  ...tokenBySymbol(sym),
}));

export default function Index() {
  const [fromToken, setFromToken] = useState<Token>(tokenBySymbol("ETH"));
  const [toToken, setToToken] = useState<Token>(tokenBySymbol("SBCK"));
  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [selecting, setSelecting] = useState<null | "from" | "to">(null);
  const [slippage, setSlippage] = useState<number>(() => {
    const v =
      typeof window !== "undefined"
        ? localStorage.getItem("slippagePct")
        : null;
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) ? n : 0.5;
  });

  const [fromBalance, setFromBalance] = useState<number | undefined>(undefined);
  const [toBalance, setToBalance] = useState<number | undefined>(undefined);

  // Fetch USD prices from Dexscreener for any token
  const ETH_SENTINEL = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  const WETH_ADDRESS = "0x4200000000000000000000000000000000000006"; // Base WETH

  const tokenAddresses = useMemo(() => {
    const addresses: string[] = [];

    // For fromToken: use WETH address if it's ETH, otherwise use token address
    if (fromToken.symbol.toUpperCase() === "ETH") {
      addresses.push(WETH_ADDRESS);
    } else if (fromToken.address && fromToken.address !== ETH_SENTINEL) {
      addresses.push(fromToken.address);
    }

    // For toToken: use WETH address if it's ETH, otherwise use token address
    if (toToken.symbol.toUpperCase() === "ETH") {
      addresses.push(WETH_ADDRESS);
    } else if (toToken.address && toToken.address !== ETH_SENTINEL) {
      addresses.push(toToken.address);
    }

    return addresses;
  }, [fromToken.address, fromToken.symbol, toToken.address, toToken.symbol]);

  const { data: dexscreenerData } = useDexscreenerTokenStats(tokenAddresses);

  const canSwap = useMemo(() => {
    const a = Number(fromAmount);
    return Number.isFinite(a) && a > 0 && fromToken.symbol !== toToken.symbol;
  }, [fromAmount, fromToken.symbol, toToken.symbol]);

  // Check if user has insufficient balance
  const hasInsufficientBalance = useMemo(() => {
    if (!fromBalance || !fromAmount) return false;
    return Number(fromAmount) > fromBalance;
  }, [fromBalance, fromAmount]);

  const { address, isConnected } = useAccount();
  const { connectors, connect } = useConnect();
  const { writeContractAsync, isPending: isWriting } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();
  const { switchChain } = useSwitchChain();
  const chainId = useChainId();

  const [swapStatus, setSwapStatus] = useState<"idle" | "checking" | "approving" | "confirming" | "swapping" | "waiting">("idle");

  const cta = useMemo(() => {
    if (!isConnected)
      return { label: "Connect Wallet", disabled: false } as const;
    if (chainId !== base.id)
      return { label: "Switch to Base", disabled: false } as const;
    if (swapStatus !== "idle") {
      const statusLabels = {
        checking: "Checking allowance...",
        approving: "Approve in wallet...",
        confirming: "Confirming approval...",
        swapping: "Swap in wallet...",
        waiting: "Confirming swap...",
        idle: "Swap",
      };
      return { label: statusLabels[swapStatus], disabled: true } as const;
    }
    if (hasInsufficientBalance && fromAmount) {
      return { label: "Insufficient Balance", disabled: true } as const;
    }
    if (canSwap) return { label: isWriting ? "Processing..." : "Swap", disabled: isWriting } as const;
    return { label: "Enter an amount", disabled: true } as const;
  }, [isConnected, swapStatus, canSwap, isWriting, hasInsufficientBalance, fromAmount]);

  const connectPreferred = () => {
    const preferred =
      connectors.find((c) => c.id === "injected") ?? connectors[0];
    if (preferred) connect({ connector: preferred, chainId: base.id });
  };

  const { data: remoteTokens } = useTokenList();
  const publicClient = usePublicClient();
  const [quoteOut, setQuoteOut] = useState<null | {
    wei: bigint;
    formatted: string;
    venue?: string;
    feeWei?: bigint;
    priceImpact?: number;
  }>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    // Load from localStorage on mount and clean old transactions
    if (typeof window === "undefined") return [];
    try {
      const stored = localStorage.getItem("swap-history");
      if (!stored) return [];
      const all = JSON.parse(stored) as Transaction[];
      // Remove transactions older than 30 days
      const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
      const cleaned = all.filter(tx => tx.timestamp > thirtyDaysAgo);
      // Save back cleaned list
      if (cleaned.length !== all.length) {
        localStorage.setItem("swap-history", JSON.stringify(cleaned));
      }
      return cleaned;
    } catch (e) {
      console.error("Failed to load transaction history:", e);
      return [];
    }
  });

  function resolveMeta(t: Token): {
    address: `0x${string}` | "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    decimals: number;
  } | null {
    // Always handle ETH/WETH specially
    const symbol = t.symbol.toUpperCase();
    if (symbol === "ETH" || symbol === "WETH") {
      // If it's WETH with an address, use that address but keep 18 decimals
      if (symbol === "WETH" && t.address) {
        console.log(`✅ Resolved ${symbol} from address:`, { address: t.address, decimals: 18 });
        return { address: t.address as `0x${string}`, decimals: 18 };
      }
      // Native ETH
      console.log(`✅ Resolved ${symbol} as native:`, { address: "0xeeee...eeee", decimals: 18 });
      return {
        address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        decimals: 18,
      };
    }

    // Try local TOKEN_META first (most reliable for our curated list)
    const localMeta = TOKEN_META[symbol];
    if (localMeta?.address && localMeta?.decimals != null && localMeta.decimals > 0) {
      console.log(`✅ Resolved ${symbol} from TOKEN_META:`, { address: localMeta.address, decimals: localMeta.decimals });
      return { address: localMeta.address as `0x${string}`, decimals: localMeta.decimals };
    }

    // Try to find in remote tokens by address (most reliable from API)
    if (t.address) {
      const byAddr = (remoteTokens || []).find(
        (rt) => rt.address?.toLowerCase() === t.address?.toLowerCase(),
      );
      if (byAddr && byAddr.decimals > 0) {
        console.log(`✅ Resolved ${symbol} from remote by address:`, { address: byAddr.address, decimals: byAddr.decimals });
        return { address: byAddr.address, decimals: byAddr.decimals };
      }
    }

    // Try to find in remote tokens by symbol
    const bySym = (remoteTokens || []).find(
      (rt) => rt.symbol?.toUpperCase() === symbol,
    );
    if (bySym && bySym.decimals > 0) {
      console.log(`✅ Resolved ${symbol} from remote by symbol:`, { address: bySym.address, decimals: bySym.decimals });
      return { address: bySym.address, decimals: bySym.decimals };
    }

    // Fall back to local token data if it has valid decimals
    if (t.address && t.decimals != null && t.decimals > 0) {
      console.log(`✅ Resolved ${symbol} from token prop:`, { address: t.address, decimals: t.decimals });
      return { address: t.address as any, decimals: t.decimals };
    }

    // Last resort: return with 18 decimals (most common for ERC20)
    if (t.address) {
      console.warn(`⚠️  Token ${t.symbol} has no decimals info, defaulting to 18`);
      return { address: t.address as any, decimals: 18 };
    }

    console.error(`❌ Could not resolve meta for token ${t.symbol}`);
    return null;
  }

  // Translate technical errors into user-friendly messages
  const formatErrorMessage = (error: any): string => {
    const msg = error?.shortMessage || error?.message || String(error);

    // Common error patterns with actionable guidance
    if (msg.includes("insufficient funds") || msg.includes("insufficient balance")) {
      return "Insufficient balance. You don't have enough tokens to complete this swap. Try reducing the amount.";
    }
    if (msg.includes("User rejected") || msg.includes("user rejected") || msg.includes("User denied")) {
      return "Transaction cancelled. You rejected the transaction in your wallet.";
    }
    if (msg.includes("allowance") || msg.includes("transfer amount exceeds allowance")) {
      return "Token approval failed. Please try again and approve the token spending in your wallet.";
    }
    if (msg.includes("INSUFFICIENT_OUTPUT_AMOUNT") || msg.includes("slippage") || msg.includes("too little received")) {
      return "Price moved unfavorably. Try increasing your slippage tolerance (currently " + slippage + "%) or wait a moment and try again.";
    }
    if (msg.includes("INSUFFICIENT_LIQUIDITY") || msg.includes("insufficient liquidity")) {
      return "Insufficient liquidity. This pool doesn't have enough liquidity for this trade size. Try a smaller amount or different token pair.";
    }
    if (msg.includes("EXPIRED") || msg.includes("deadline") || msg.includes("transaction too old")) {
      return "Transaction expired. The network was too busy and the transaction took too long. Please try again.";
    }
    if (msg.includes("cannot estimate gas") || msg.includes("gas required exceeds")) {
      return "Transaction will fail. This usually means insufficient balance or an issue with the trade. Check your balances and try again.";
    }
    if (msg.includes("nonce too low") || msg.includes("replacement transaction")) {
      return "Transaction conflict detected. Please wait for your pending transactions to complete, then try again.";
    }
    if (msg.includes("network") || msg.includes("fetch failed") || msg.includes("could not detect network")) {
      return "Network connection error. Please check your internet connection and ensure your wallet is connected to Base Sepolia.";
    }
    if (msg.includes("execution reverted") && !msg.includes("INSUFFICIENT")) {
      return "Transaction failed. The smart contract rejected this transaction. This may be due to insufficient balance, allowance, or liquidity.";
    }
    if (msg.includes("replacement fee too low")) {
      return "Gas price too low. Your previous transaction is still pending. Either wait for it to complete or increase the gas price.";
    }

    // If no pattern matches, return a cleaned version
    return msg.length > 150 ? msg.substring(0, 150) + "..." : msg;
  };

  useEffect(() => {
    let cancel = false;
    async function run() {
      setQuoteError(null);
      setQuoteOut(null);
      if (!canSwap || !publicClient) return;
      const inMeta = resolveMeta(fromToken);
      const outMeta = resolveMeta(toToken);
      if (!inMeta || !outMeta) return;
      try {
        setQuoting(true);
        const gasPrice = await publicClient.getGasPrice();
        const amountWei = toWei(fromAmount, inMeta.decimals);
        if (amountWei <= 0n) return;
        const q = await getBestAggregatedQuote(
          publicClient,
          { address: inMeta.address, decimals: inMeta.decimals },
          { address: outMeta.address, decimals: outMeta.decimals },
          amountWei,
          gasPrice,
        );
        if (cancel) return;

        // Safety check: ensure we have valid decimals
        const decimals = outMeta.decimals > 0 ? outMeta.decimals : 18;
        const formattedAmount = fromWei(q.outAmountWei, decimals);

        // Debug log to catch decimal issues
        console.log('Quote formatting:', {
          token: toToken.symbol,
          wei: q.outAmountWei.toString(),
          decimals,
          formatted: formattedAmount,
        });

        setQuoteOut({
          wei: q.outAmountWei,
          formatted: formattedAmount,
          venue: q.venue,
          feeWei: q.feeTakenWei,
          priceImpact: q.priceImpact,
        });
      } catch (e: any) {
        if (!cancel) {
          const friendlyError = formatErrorMessage(e);
          setQuoteError(friendlyError);
        }
      } finally {
        if (!cancel) setQuoting(false);
      }
    }
    run();
    return () => {
      cancel = true;
    };
  }, [canSwap, fromAmount, fromToken, toToken, remoteTokens, publicClient]);

  // Reflect quoted output into the receive input
  useEffect(() => {
    if (quoteOut) setToAmount(quoteOut.formatted);
    else setToAmount("");
  }, [quoteOut]);

  // Listen for global slippage updates from dialog
  useEffect(() => {
    const handler = () => {
      const v =
        typeof window !== "undefined"
          ? Number(localStorage.getItem("slippagePct") || "0.5")
          : 0.5;
      if (Number.isFinite(v)) setSlippage(v);
    };
    document.addEventListener("sb:slippage-updated", handler as any);
    return () =>
      document.removeEventListener("sb:slippage-updated", handler as any);
  }, []);

  // Fetch balances for selected tokens
  useEffect(() => {
    let cancel = false;
    async function getBalanceForToken(t: Token): Promise<number | undefined> {
      if (!publicClient || !address) return undefined;
      if (t.symbol.toUpperCase() === "ETH") {
        const bal = await publicClient.getBalance({ address });
        return Number(formatUnits(bal, 18));
      }
      const meta = resolveMeta(t);
      if (!meta?.address) return undefined;
      const bal = (await publicClient.readContract({
        address: meta.address as any,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address],
      })) as bigint;
      return Number(formatUnits(bal, meta.decimals ?? 18));
    }
    async function run() {
      setFromBalance(undefined);
      setToBalance(undefined);
      if (!isConnected || !address) return;
      try {
        const [fb, tb] = await Promise.all([
          getBalanceForToken(fromToken),
          getBalanceForToken(toToken),
        ]);
        if (cancel) return;
        setFromBalance(fb);
        setToBalance(tb);
      } catch {
        if (!cancel) {
          setFromBalance(undefined);
          setToBalance(undefined);
        }
      }
    }
    run();
    return () => {
      cancel = true;
    };
  }, [isConnected, address, fromToken, toToken, publicClient, remoteTokens]);

  const handleFlip = () => {
    setFromToken(toToken);
    setToToken(fromToken);
    setFromAmount(toAmount);
    setToAmount(fromAmount);
  };

  // Calculate USD values for input amounts
  const fromUsdValue = useMemo(() => {
    if (!dexscreenerData) return undefined;

    // For ETH, use WETH price
    const lookupAddress = fromToken.symbol.toUpperCase() === "ETH"
      ? WETH_ADDRESS.toLowerCase()
      : fromToken.address?.toLowerCase();

    if (!lookupAddress) return undefined;

    const tokenData = dexscreenerData[lookupAddress];
    const price = tokenData?.priceUsd;
    const amount = Number(fromAmount);
    if (!price || !amount || !Number.isFinite(amount)) return undefined;
    return formatUSD(price * amount);
  }, [fromAmount, fromToken.address, fromToken.symbol, dexscreenerData]);

  const toUsdValue = useMemo(() => {
    if (!dexscreenerData) return undefined;

    // For ETH, use WETH price
    const lookupAddress = toToken.symbol.toUpperCase() === "ETH"
      ? WETH_ADDRESS.toLowerCase()
      : toToken.address?.toLowerCase();

    if (!lookupAddress) return undefined;

    const tokenData = dexscreenerData[lookupAddress];
    const price = tokenData?.priceUsd;
    const amount = Number(toAmount);
    if (!price || !amount || !Number.isFinite(amount)) return undefined;
    return formatUSD(price * amount);
  }, [toAmount, toToken.address, toToken.symbol, dexscreenerData]);

  // Get price impact styling and warning level
  const getPriceImpactInfo = (impact: number | undefined) => {
    if (!impact || impact < 0.01) return { color: "text-foreground", level: "none" };
    if (impact < 1) return { color: "text-green-400", level: "low" };
    if (impact < 5) return { color: "text-yellow-400", level: "medium" };
    if (impact < 10) return { color: "text-orange-400", level: "high" };
    return { color: "text-red-400", level: "critical" };
  };

  const priceImpactInfo = getPriceImpactInfo(quoteOut?.priceImpact);

  // Clean old transactions (older than 30 days)
  const cleanOldTransactions = (txs: Transaction[]) => {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    return txs.filter(tx => tx.timestamp > thirtyDaysAgo);
  };

  // Save transactions to localStorage
  const saveTransaction = (tx: Transaction) => {
    const cleaned = cleanOldTransactions([tx, ...transactions]);
    setTransactions(cleaned);
    try {
      localStorage.setItem("swap-history", JSON.stringify(cleaned));
    } catch (e) {
      console.error("Failed to save transaction history:", e);
    }
  };

  // Update transaction status
  const updateTransactionStatus = (hash: string, status: Transaction["status"]) => {
    const updated = transactions.map((tx) =>
      tx.hash === hash ? { ...tx, status } : tx
    );
    const cleaned = cleanOldTransactions(updated);
    setTransactions(cleaned);
    try {
      localStorage.setItem("swap-history", JSON.stringify(cleaned));
    } catch (e) {
      console.error("Failed to update transaction history:", e);
    }
  };

  async function handleSwap() {
    if (!isConnected || !address || !publicClient) return connectPreferred();
    const inMeta = resolveMeta(fromToken);
    const outMeta = resolveMeta(toToken);
    if (!inMeta || !outMeta) return;
    try {
      setQuoteError(null);
      setSwapStatus("checking");
      const amountWei = toWei(fromAmount, inMeta.decimals);
      if (amountWei <= 0n || !quoteOut?.wei) return;

      let txHash: string;

      // Route based on venue
      if (quoteOut.venue === "silverback-v2") {
        setSwapStatus("swapping");
        // Direct V2 swap (testnet-friendly, no OpenOcean dependency)
        toast({
          title: "Swapping via Silverback V2",
          description: "Confirm the transaction in your wallet...",
        });

        const result = await executeSwapViaSilverbackV2(
          publicClient,
          writeContractAsync,
          address,
          { address: inMeta.address, decimals: inMeta.decimals },
          { address: outMeta.address, decimals: outMeta.decimals },
          amountWei,
          quoteOut.wei,
          Math.round(slippage * 100),
        );
        txHash = result.txHash;
      } else {
        // OpenOcean aggregated swap with hybrid execution:
        // - ETH swaps: Use router (collects 0.3% fee)
        // - Token swaps: Direct OpenOcean (no fee, but they work)
        const isEthInput = fromToken.symbol === "ETH";

        if (isEthInput) {
          // ETH → Token swap via UnifiedRouter (with 0.3% fee)
          const router = unifiedRouterAddress();
          if (!router) {
            setQuoteError("Set VITE_SB_UNIFIED_ROUTER env to the deployed router address");
            setSwapStatus("idle");
            return;
          }

          setSwapStatus("swapping");
          toast({
            title: "Swapping via OpenOcean",
            description: "Confirm the transaction in your wallet...",
          });

          try {
            const result = await executeSwapViaOpenOcean(
              publicClient,
              writeContractAsync,
              address,
              router,
              { address: inMeta.address, decimals: inMeta.decimals },
              { address: outMeta.address, decimals: outMeta.decimals },
              amountWei,
              quoteOut.wei,
              Math.round(slippage * 100),
            );
            txHash = result.txHash;
          } catch (openOceanError: any) {
            // If OpenOcean fails, try falling back to Silverback V2
            const errorMessage = openOceanError?.message || String(openOceanError);
            if (errorMessage.includes("No liquidity available") || errorMessage.includes("calldata too short")) {
              console.warn("⚠️  OpenOcean failed, falling back to Silverback V2:", errorMessage);

              toast({
                title: "Routing via Silverback V2",
                description: "OpenOcean unavailable, using Silverback liquidity...",
              });

              const result = await executeSwapViaSilverbackV2(
                publicClient,
                writeContractAsync,
                address,
                { address: inMeta.address, decimals: inMeta.decimals },
                { address: outMeta.address, decimals: outMeta.decimals },
                amountWei,
                quoteOut.wei,
                Math.round(slippage * 100),
              );
              txHash = result.txHash;
            } else {
              // If it's a different error (user rejected, etc.), re-throw
              throw openOceanError;
            }
          }
        } else {
          // Token → * swap via direct OpenOcean (no fee collection)
          setSwapStatus("swapping");
          toast({
            title: "Swapping via OpenOcean",
            description: "No protocol fee on this swap. Confirm transaction...",
          });

          try {
            const result = await executeSwapDirectlyViaOpenOcean(
              publicClient,
              writeContractAsync,
              sendTransactionAsync,
              address,
              { address: inMeta.address, decimals: inMeta.decimals },
              { address: outMeta.address, decimals: outMeta.decimals },
              amountWei,
              Math.round(slippage * 100),
              (status) => {
                if (status === "approving") {
                  setSwapStatus("approving");
                } else if (status === "confirming") {
                  setSwapStatus("confirming");
                } else if (status === "complete") {
                  setSwapStatus("swapping");
                }
              },
            );
            txHash = result.txHash;
          } catch (openOceanError: any) {
            // If OpenOcean fails, try falling back to Silverback V2
            const errorMessage = openOceanError?.message || String(openOceanError);
            if (errorMessage.includes("No liquidity available") || errorMessage.includes("calldata too short")) {
              console.warn("⚠️  OpenOcean failed, falling back to Silverback V2:", errorMessage);

              toast({
                title: "Routing via Silverback V2",
                description: "OpenOcean unavailable, using Silverback liquidity...",
              });

              const result = await executeSwapViaSilverbackV2(
                publicClient,
                writeContractAsync,
                address,
                { address: inMeta.address, decimals: inMeta.decimals },
                { address: outMeta.address, decimals: outMeta.decimals },
                amountWei,
                quoteOut.wei,
                Math.round(slippage * 100),
              );
              txHash = result.txHash;
            } else {
              // If it's a different error (user rejected, etc.), re-throw
              throw openOceanError;
            }
          }
        }
      }

      // Save transaction to history (pending state)
      const transaction: Transaction = {
        hash: txHash,
        timestamp: Date.now(),
        fromToken: {
          symbol: fromToken.symbol,
          amount: Number(fromAmount).toFixed(4),
        },
        toToken: {
          symbol: toToken.symbol,
          amount: quoteOut ? Number(quoteOut.formatted).toFixed(4) : "0",
        },
        status: "pending",
        venue: quoteOut?.venue,
      };
      saveTransaction(transaction);

      // Show pending toast
      setSwapStatus("waiting");
      const explorerUrl = `https://basescan.org/tx/${txHash}`;
      toast({
        title: "Transaction Submitted",
        description: (
          <div className="flex flex-col gap-1">
            <span>Waiting for confirmation...</span>
            <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="text-sky-400 underline text-xs">
              View on Basescan
            </a>
          </div>
        ),
      });

      // Wait for confirmation
      await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });

      // Update transaction status to success
      updateTransactionStatus(txHash, "success");

      // Show success toast
      toast({
        title: "Swap Successful!",
        description: (
          <div className="flex flex-col gap-1">
            <span>Your swap completed successfully</span>
            <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="text-sky-400 underline text-xs">
              View on Basescan
            </a>
          </div>
        ),
      });

      // Clear inputs
      setFromAmount("");
      setToAmount("");
      setSwapStatus("idle");
    } catch (e: any) {
      const errorMsg = formatErrorMessage(e);
      console.error("Swap error:", e);
      setQuoteError(errorMsg);
      setSwapStatus("idle");

      // If there was a transaction hash, mark it as failed
      // (Sometimes errors happen before txHash is created)
      const txHashMatch = e?.message?.match(/0x[a-fA-F0-9]{64}/);
      if (txHashMatch) {
        updateTransactionStatus(txHashMatch[0], "failed");
      }

      toast({
        title: "Swap Failed",
        description: errorMsg,
        variant: "destructive",
      });
    }
  }

  return (
    <div className="min-h-[calc(100vh-4rem)]">
      <div className="container py-10">
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 md:grid-cols-5">
          <section className="order-1 md:order-1 md:col-span-3">
            <div className="glass-card-elevated rounded-2xl p-6">
              <div className="mb-4 flex items-center justify-between">
                <h1 className="text-xl font-semibold">Swap</h1>
                <button
                  type="button"
                  className="text-xs text-sky-400 hover:underline"
                  onClick={() =>
                    document.dispatchEvent(new Event("sb:open-slippage"))
                  }
                >
                  Slippage {slippage}%
                </button>
              </div>
              <div className="space-y-3">
                <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Select a share of your balance</span>
                  <QuickFill balance={fromBalance} onSelect={setFromAmount} />
                </div>
                <TokenInput
                  label="You pay"
                  token={fromToken}
                  amount={fromAmount}
                  onAmountChange={setFromAmount}
                  onTokenClick={() => setSelecting("from")}
                  balance={fromBalance}
                  usdValue={fromUsdValue}
                />

                <div className="flex items-center justify-center py-1">
                  <Button
                    variant="secondary"
                    size="icon"
                    onClick={handleFlip}
                    aria-label="Switch tokens"
                  >
                    <ArrowDownUp />
                  </Button>
                </div>

                <TokenInput
                  label="You receive"
                  token={toToken}
                  amount={toAmount}
                  onAmountChange={setToAmount}
                  onTokenClick={() => setSelecting("to")}
                  balance={toBalance}
                  disabled
                  usdValue={toUsdValue}
                />
              </div>

              {/* Quote Error Banner - Show prominently above price details */}
              {quoteError && fromAmount && (
                <div className="mt-4 rounded-xl border border-red-400/40 bg-red-400/10 p-3 text-sm">
                  <div className="flex items-start gap-2">
                    <span className="text-red-400 text-lg">⚠️</span>
                    <div>
                      <div className="font-semibold text-red-400">Unable to Calculate Swap</div>
                      <div className="text-xs text-red-300/80 mt-1">
                        {quoteError}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-4 rounded-xl glass-card p-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Price</span>
                  <span className="flex items-center gap-2">
                    {quoting && <Spinner size="sm" />}
                    {quoteOut && Number(fromAmount) > 0
                      ? `${(Number(quoteOut.formatted) / Number(fromAmount)).toFixed(6)} ${toToken.symbol}`
                      : quoting
                        ? "Fetching quote..."
                        : `–`}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-muted-foreground">
                    Minimum received
                  </span>
                  <span>
                    {quoteOut
                      ? `${(Number(quoteOut.formatted) * (1 - slippage / 100)).toFixed(6)} ${toToken.symbol}`
                      : "–"}
                  </span>
                </div>
                {quoteOut?.priceImpact !== undefined && (
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-muted-foreground">Price Impact</span>
                    <span className={priceImpactInfo.color}>
                      {quoteOut.priceImpact < 0.01 ? "<0.01%" : `${quoteOut.priceImpact.toFixed(2)}%`}
                    </span>
                  </div>
                )}
                {quoteOut?.venue && (
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-muted-foreground">Route</span>
                    <span className="flex items-center gap-1.5">
                      {quoteOut.venue === "silverback-v2" ? (
                        <>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-400 font-medium">
                            Silverback V2
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400 font-medium">
                            OpenOcean
                          </span>
                        </>
                      )}
                    </span>
                  </div>
                )}
              </div>

              {/* Insufficient Balance Warning Banner */}
              {hasInsufficientBalance && fromAmount && (
                <div className="mt-3 rounded-xl border border-red-400/40 bg-red-400/10 p-3 text-sm">
                  <div className="flex items-start gap-2">
                    <span className="text-red-400 text-lg">💰</span>
                    <div>
                      <div className="font-semibold text-red-400">Insufficient Balance</div>
                      <div className="text-xs text-red-300/80 mt-1">
                        You're trying to swap {Number(fromAmount).toFixed(4)} {fromToken.symbol}, but you only have {fromBalance?.toFixed(4) || "0"} {fromToken.symbol}. Please reduce the amount.
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Price Impact Warning Banner */}
              {priceImpactInfo.level === "high" && (
                <div className="mt-3 rounded-xl border border-orange-400/40 bg-orange-400/10 p-3 text-sm">
                  <div className="flex items-start gap-2">
                    <span className="text-orange-400 text-lg">⚠</span>
                    <div>
                      <div className="font-semibold text-orange-400">High Price Impact</div>
                      <div className="text-xs text-orange-300/80 mt-1">
                        This trade will move the market price significantly. Consider splitting into smaller trades.
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {priceImpactInfo.level === "critical" && (
                <div className="mt-3 rounded-xl border border-red-400/40 bg-red-400/10 p-3 text-sm">
                  <div className="flex items-start gap-2">
                    <span className="text-red-400 text-lg">🚨</span>
                    <div>
                      <div className="font-semibold text-red-400">Critical Price Impact</div>
                      <div className="text-xs text-red-300/80 mt-1">
                        This trade has extremely high price impact (&gt;10%). You may lose a significant portion of your funds. Please review carefully.
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <Button
                className="mt-4 h-12 w-full bg-gradient-to-br from-white/20 to-white/10 hover:from-white/30 hover:to-white/20 border border-white/20 text-white font-semibold crisp-button mono-glow"
                disabled={cta.disabled}
                onClick={() => {
                  if (!isConnected) connectPreferred();
                  else if (chainId !== base.id) switchChain({ chainId: base.id });
                  else handleSwap();
                }}
              >
                {swapStatus !== "idle" && <Spinner size="sm" className="mr-2" />}
                {cta.label}
              </Button>
            </div>
          </section>

          <aside className="order-2 md:order-2 md:col-span-2 space-y-6">
            <div className="glass-card rounded-2xl p-5">
              <TrendingPills symbols={["ETH", "KTA", "AERO", "SBCK"]} />
            </div>
            <TransactionHistory transactions={transactions} />
          </aside>
        </div>
      </div>
      {selecting && (
        <TokenSelector
          open={!!selecting}
          onClose={() => setSelecting(null)}
          onSelect={(t) => {
            if (selecting === "from") setFromToken(t);
            else setToToken(t);
          }}
        />
      )}
    </div>
  );
}
