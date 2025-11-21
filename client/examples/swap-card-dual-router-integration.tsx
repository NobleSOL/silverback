/**
 * EXAMPLE: Integrating Dual Router System into Swap Card
 *
 * This example shows how to modify the existing Index.tsx swap card to use
 * the SwapRouterService for intelligent routing between:
 * - Silverback V2 Router (Direct Silverback swaps, 0.25% pair + 0.05% protocol = 0.30% total)
 * - UnifiedRouter (Aggregated swaps, OpenOcean integration)
 *
 * KEY CHANGES FROM CURRENT IMPLEMENTATION:
 * 1. Import and instantiate SwapRouterService
 * 2. Replace quote fetching logic with getBestRoute()
 * 3. Update swap execution to use executeSwap()
 * 4. Display route information to user
 */

import React, { useEffect, useMemo, useState } from "react";
import { useAccount, usePublicClient, useWriteContract, useChainId } from "wagmi";
import { createSwapRouter, SwapRoute } from "@/lib/swap-router";
import { SILVERBACK_V2_FACTORY, SILVERBACK_V2_ROUTER, SILVERBACK_UNIFIED_ROUTER } from "@/amm/config";
import { ERC20_ABI } from "@/lib/erc20";
import { ethers } from "ethers";
import type { Address } from "viem";

// Example token interface (adapt to your existing Token type)
interface Token {
  symbol: string;
  address: string;
  decimals: number;
}

export default function SwapCardExample() {
  const [fromToken, setFromToken] = useState<Token>({ symbol: "ETH", address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", decimals: 18 });
  const [toToken, setToToken] = useState<Token>({ symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 });
  const [fromAmount, setFromAmount] = useState("");

  // NEW: Store the best route
  const [bestRoute, setBestRoute] = useState<SwapRoute | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const chainId = useChainId();

  // NEW: Initialize SwapRouterService
  const swapRouter = useMemo(() => {
    if (!publicClient) return null;

    // Convert wagmi publicClient to ethers BrowserProvider
    const provider = new ethers.BrowserProvider(window.ethereum as any);

    return createSwapRouter(
      SILVERBACK_V2_FACTORY as Address,
      SILVERBACK_V2_ROUTER as Address,
      SILVERBACK_UNIFIED_ROUTER as Address,
      provider
    );
  }, [publicClient]);

  // NEW: Fetch best route when inputs change
  useEffect(() => {
    let cancel = false;

    async function fetchBestRoute() {
      if (!swapRouter || !fromAmount || !fromToken || !toToken || !address) {
        setBestRoute(null);
        return;
      }

      const amount = parseFloat(fromAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        setBestRoute(null);
        return;
      }

      try {
        setQuoting(true);
        setQuoteError(null);

        // Convert amount to wei
        const amountWei = ethers.parseUnits(fromAmount, fromToken.decimals);

        // Get best route from both Silverback and aggregator
        const route = await swapRouter.getBestRoute(
          {
            tokenIn: fromToken.address as Address,
            tokenOut: toToken.address as Address,
            amountIn: amountWei.toString(),
            slippage: 0.5, // 0.5% slippage tolerance
            userAddress: address as Address,
          },
          chainId
        );

        if (cancel) return;

        if (!route) {
          setQuoteError("No routes available for this token pair");
          setBestRoute(null);
          return;
        }

        setBestRoute(route);
        console.log('✅ Best route found:', {
          router: route.router,
          source: route.source,
          fee: route.fee,
          amountOut: route.amountOutHuman,
          priceImpact: route.priceImpact,
        });

      } catch (error: any) {
        if (!cancel) {
          console.error('Quote error:', error);
          setQuoteError(error.message || 'Failed to get quote');
          setBestRoute(null);
        }
      } finally {
        if (!cancel) setQuoting(false);
      }
    }

    fetchBestRoute();

    return () => {
      cancel = true;
    };
  }, [swapRouter, fromAmount, fromToken, toToken, address, chainId]);

  // NEW: Execute swap using selected route
  async function handleSwap() {
    if (!swapRouter || !bestRoute || !address || !writeContractAsync) {
      console.error('Missing requirements for swap');
      return;
    }

    try {
      console.log('🔄 Starting swap...');

      // Step 1: Approve tokens to the selected router
      console.log(`📝 Approving ${fromToken.symbol} to ${bestRoute.routerAddress}...`);

      const tokenContract = {
        address: fromToken.address as Address,
        abi: ERC20_ABI,
      };

      const amountWei = ethers.parseUnits(fromAmount, fromToken.decimals);

      // Check current allowance
      const currentAllowance = await publicClient!.readContract({
        ...tokenContract,
        functionName: 'allowance',
        args: [address, bestRoute.routerAddress],
      }) as bigint;

      // Approve if needed
      if (currentAllowance < amountWei) {
        const approveTx = await writeContractAsync({
          ...tokenContract,
          functionName: 'approve',
          args: [bestRoute.routerAddress, amountWei],
        });
        console.log('✅ Approval tx:', approveTx);

        // Wait for approval confirmation
        await publicClient!.waitForTransactionReceipt({ hash: approveTx });
        console.log('✅ Approval confirmed');
      }

      // Step 2: Execute swap
      console.log(`💱 Executing swap via ${bestRoute.router}...`);

      // Convert wagmi writeContractAsync to ethers signer
      const provider = new ethers.BrowserProvider(window.ethereum as any);
      const signer = await provider.getSigner();

      const tx = await swapRouter.executeSwap(
        bestRoute,
        {
          tokenIn: fromToken.address as Address,
          tokenOut: toToken.address as Address,
          amountIn: amountWei.toString(),
          slippage: 0.5,
          userAddress: address as Address,
        },
        signer
      );

      console.log('🎉 Swap submitted:', tx.hash);

      // Wait for confirmation
      const receipt = await tx.wait();
      console.log('✅ Swap confirmed in block:', receipt?.blockNumber);

      // Reset form
      setFromAmount("");
      setBestRoute(null);

    } catch (error: any) {
      console.error('Swap failed:', error);

      // User-friendly error messages
      if (error.message?.includes('user rejected')) {
        alert('Transaction cancelled');
      } else if (error.message?.includes('insufficient')) {
        alert('Insufficient balance or allowance');
      } else {
        alert(`Swap failed: ${error.message}`);
      }
    }
  }

  return (
    <div className="swap-card">
      <h2>Swap</h2>

      {/* From Token Input */}
      <div className="token-input">
        <label>From</label>
        <input
          type="number"
          value={fromAmount}
          onChange={(e) => setFromAmount(e.target.value)}
          placeholder="0.0"
        />
        <span>{fromToken.symbol}</span>
      </div>

      {/* To Token Output */}
      <div className="token-output">
        <label>To</label>
        <div className="output-amount">
          {quoting ? (
            <span>Calculating...</span>
          ) : bestRoute ? (
            <span>{bestRoute.amountOutHuman.toFixed(6)}</span>
          ) : (
            <span>-</span>
          )}
        </div>
        <span>{toToken.symbol}</span>
      </div>

      {/* NEW: Route Information Display */}
      {bestRoute && (
        <div className="route-info">
          <div className="route-detail">
            <span>Route:</span>
            <strong>{bestRoute.source}</strong>
          </div>
          <div className="route-detail">
            <span>Fee:</span>
            <strong>{bestRoute.fee}</strong>
          </div>
          <div className="route-detail">
            <span>Price Impact:</span>
            <strong>{bestRoute.priceImpact.toFixed(2)}%</strong>
          </div>
          <div className="route-detail">
            <span>Router:</span>
            <strong>{bestRoute.router === 'silverback' ? 'Silverback V2' : 'Aggregator'}</strong>
          </div>
        </div>
      )}

      {/* Error Display */}
      {quoteError && (
        <div className="error-message">
          {quoteError}
        </div>
      )}

      {/* Swap Button */}
      <button
        onClick={handleSwap}
        disabled={!bestRoute || quoting || !isConnected}
        className="swap-button"
      >
        {!isConnected ? 'Connect Wallet' : quoting ? 'Getting quote...' : 'Swap'}
      </button>

      {/* Route Comparison (Optional Debug Info) */}
      {process.env.NODE_ENV === 'development' && bestRoute && (
        <details className="route-debug">
          <summary>Route Details (Dev)</summary>
          <pre>{JSON.stringify(bestRoute, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

/**
 * INTEGRATION CHECKLIST:
 *
 * 1. ✅ Import SwapRouterService and config addresses
 * 2. ✅ Create swapRouter instance using createSwapRouter()
 * 3. ✅ Replace quote fetching with getBestRoute()
 * 4. ✅ Update swap execution to use executeSwap()
 * 5. ✅ Display route information (source, fee, router)
 * 6. ✅ Handle token approvals for selected router
 * 7. ✅ Convert between wagmi and ethers types
 *
 * ENVIRONMENT VARIABLES NEEDED:
 * - VITE_SB_V2_FACTORY=0x9cd714C51586B52DD56EbD19E3676de65eBf44Ae (Base Mainnet)
 * - VITE_SB_V2_ROUTER=0x07d00debE946d9183A4dB7756A8A54582c6F205b (Base Mainnet)
 * - VITE_SB_UNIFIED_ROUTER=0x565cBf0F3eAdD873212Db91896e9a548f6D64894 (Aggregator)
 *
 * BENEFITS OF THIS APPROACH:
 * ✅ Automatic price comparison between Silverback and aggregators
 * ✅ Always gets best price for user
 * ✅ Collects 0.3% fee on direct swaps OR aggregated swaps
 * ✅ No double-dipping (users never pay 0.6%)
 * ✅ User experience is seamless - just "Swap" button
 * ✅ Shows which route is being used transparently
 */
