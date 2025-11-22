import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import {
  Loader2,
  Wallet,
  Droplets,
  Plus,
  ArrowDownUp,
  Copy,
  CheckCircle2,
  Send,
  Info,
} from "lucide-react";
import { KeetaPoolCard, KeetaPoolCardData } from "@/components/keeta/KeetaPoolCard";
import { PoolDashboard } from "@/components/pool/PoolDashboard";
import { useKeetaWallet } from "@/contexts/KeetaWalletContext";
import {
  addLiquidity as addLiquidityClient,
  removeLiquidity as removeLiquidityClient,
} from "@/lib/keeta-client";
import { isKeythingsInstalled } from "@/lib/keythings-provider";

// API base URL
const API_BASE = import.meta.env.VITE_KEETA_API_BASE || `${window.location.origin}/api`;

export default function KeetaPool() {
  const {
    wallet,
    pools,
    positions,
    allPools,
    showAllTokens,
    setShowAllTokens,
    copiedAddress,
    tokenPrices,
    displayedTokens,
    disconnectWallet,
    refreshBalances,
    loadPools,
    fetchPositions,
    copyToClipboard,
    setSendToken,
    setSendRecipient,
    setSendAmount,
    setSendDialogOpen,
    connectKeythingsWallet,
    loading,
  } = useKeetaWallet();

  // Add liquidity state
  const [selectedPoolForLiq, setSelectedPoolForLiq] = useState<string>("");
  const [liqAmountA, setLiqAmountA] = useState("");
  const [liqAmountB, setLiqAmountB] = useState("");
  const [addingLiq, setAddingLiq] = useState(false);

  // Pool creation state
  const [createMode, setCreateMode] = useState(false);
  const [newPoolTokenA, setNewPoolTokenA] = useState<string>("");
  const [newPoolTokenB, setNewPoolTokenB] = useState<string>("");
  const [creatingPool, setCreatingPool] = useState(false);

  // Remove liquidity state
  const [removeLiqPercent, setRemoveLiqPercent] = useState(100);
  const [removingLiq, setRemovingLiq] = useState(false);

  // Calculate dashboard stats from pools data
  const dashboardStats = useMemo(() => {
    if (allPools.length === 0) {
      return {
        totalTVL: "-",
        totalPools: 0,
        totalVolume24h: "-",
        avgAPY: "-",
      };
    }

    // Calculate total TVL (sum of all reserves with token prices if available)
    let totalTVL = 0;
    let hasPriceData = false;

    allPools.forEach((pool) => {
      const reserveA = pool.reserveAHuman || 0;
      const reserveB = pool.reserveBHuman || 0;

      // Try to get USD price from tokenPrices
      const priceA = tokenPrices?.[pool.tokenA]?.priceUsd;
      const priceB = tokenPrices?.[pool.tokenB]?.priceUsd;

      if (priceA) {
        totalTVL += reserveA * priceA;
        hasPriceData = true;
      }
      if (priceB) {
        totalTVL += reserveB * priceB;
        hasPriceData = true;
      }
    });

    // Calculate average APY (assumes 10% of TVL trades daily, 0.3% fee)
    const assumedDailyVolumePercent = 0.1;
    const feePercent = 0.003;
    const avgAPY = (assumedDailyVolumePercent * feePercent * 365) * 100;

    return {
      totalTVL: hasPriceData ? `$${totalTVL.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "-",
      totalPools: allPools.length,
      totalVolume24h: "-", // Would need historical trading data
      avgAPY: avgAPY.toFixed(2),
    };
  }, [allPools, tokenPrices]);

  function toggleLiquidityTokens() {
    if (createMode) {
      // Swap Token A and Token B
      const tempToken = newPoolTokenA;
      const tempAmount = liqAmountA;
      setNewPoolTokenA(newPoolTokenB);
      setNewPoolTokenB(tempToken);
      setLiqAmountA(liqAmountB);
      setLiqAmountB(tempAmount);
    }
  }

  async function createPool() {
    if (!wallet || !newPoolTokenA || !newPoolTokenB || !liqAmountA || !liqAmountB) return;

    setCreatingPool(true);
    try {
      console.log('🏊 Creating new pool via backend API (creates STORAGE account with AMM logic)...');

      // Call backend API to create pool and add initial liquidity
      // The backend will create a proper STORAGE account with swap functionality
      const requestBody = wallet.isKeythings
        ? {
            creatorAddress: wallet.address, // For keythings: send actual address
            tokenA: newPoolTokenA,
            tokenB: newPoolTokenB,
            amountADesired: liqAmountA,
            amountBDesired: liqAmountB,
          }
        : {
            userSeed: wallet.seed, // For seed wallets: send seed
            tokenA: newPoolTokenA,
            tokenB: newPoolTokenB,
            amountADesired: liqAmountA,
            amountBDesired: liqAmountB,
          };

      const response = await fetch(`${API_BASE}/liquidity/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();

      if (data.success) {
        // Check if this is a keythings wallet that needs to add liquidity
        if (data.result?.requiresKeythingsLiquidity) {
          console.log('✅ Pool created, proceeding with keythings add liquidity flow...');

          // Pool created successfully, now add liquidity via keythings flow
          const poolAddress = data.result.poolAddress;

          toast({
            title: "Pool Created!",
            description: "Waiting for pool to be indexed by Keythings...",
          });

          // IMPORTANT: Wait 3 seconds for pool account to be indexed by Keythings extension
          // Without this delay, Keythings won't be able to see the pool account and TX1 will fail
          console.log('⏳ Waiting 3 seconds for Keythings to index pool account...');
          await new Promise(resolve => setTimeout(resolve, 3000));

          console.log('✅ Pool should be indexed, triggering add liquidity...');

          toast({
            title: "Ready to Add Liquidity",
            description: "Please approve the transaction to add initial liquidity.",
          });

          // Trigger add liquidity flow directly with pool data
          // NOTE: We can't rely on loadPools() because newly created pools with 0 reserves get filtered out
          await addLiquidityDirect(poolAddress, newPoolTokenA, newPoolTokenB, liqAmountA, liqAmountB);

        } else {
          // Seed wallet: pool created with initial liquidity
          console.log('✅ Pool created with AMM logic and initial liquidity added');

          // Build explorer link - use pool address to view the newly created pool
          const poolAddress = data.result.poolAddress;
          const explorerUrl = poolAddress
            ? `https://explorer.test.keeta.com/account/${poolAddress}`
            : `https://explorer.test.keeta.com/account/${wallet.address}`;

          toast({
            title: "Pool Created!",
            description: (
              <div className="space-y-1">
                <div>Added initial liquidity: {liqAmountA} + {liqAmountB}</div>
                <div className="text-sm text-gray-400">LP shares: {data.result.liquidity}</div>
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-400 hover:text-blue-300 underline block mt-1"
                >
                  View Pool on Explorer →
                </a>
              </div>
            ),
          });

          // Clear form
          setNewPoolTokenA("");
          setNewPoolTokenB("");
          setLiqAmountA("");
          setLiqAmountB("");

          // Wait for blockchain to sync before refreshing
          await new Promise(resolve => setTimeout(resolve, 2000));

          // Refresh data
          await refreshBalances();
          await loadPools();
          await fetchPositions();
        }
      } else {
        throw new Error(data.error || "Failed to create pool");
      }
    } catch (error: any) {
      toast({
        title: "Pool Creation Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setCreatingPool(false);
    }
  }

  async function addLiquidity() {
    if (!wallet || !selectedPoolForLiq || !liqAmountA || !liqAmountB) return;

    setAddingLiq(true);
    try {
      const pool = pools.find((p) => p.poolAddress === selectedPoolForLiq);
      if (!pool) return;

      console.log('💧 Adding liquidity...');
      console.log('  Using decimals:', pool.decimalsA, pool.decimalsB);

      // Check if this is a Keythings wallet
      if (wallet.isKeythings) {
        console.log('💧 Executing Keythings add liquidity (two-transaction flow)...');

        // Import utilities
        const { toAtomic } = await import('@/lib/keeta-swap-math');
        const { getKeythingsProvider } = await import('@/lib/keythings-provider');

        // Get Keythings user client for transaction signing
        const provider = getKeythingsProvider();
        if (!provider) {
          throw new Error('Keythings provider not found');
        }

        console.log('🔐 Requesting user client from Keythings...');
        const userClient = await provider.getUserClient();

        // Convert amounts to atomic units
        const amountAAtomic = toAtomic(parseFloat(liqAmountA), pool.decimalsA || 9);
        const amountBAtomic = toAtomic(parseFloat(liqAmountB), pool.decimalsB || 9);

        console.log('💰 Liquidity amounts:', {
          amountA: amountAAtomic.toString(),
          amountB: amountBAtomic.toString(),
        });

        // Import KeetaNet for account creation
        const KeetaNet = await import('@keetanetwork/keetanet-client');
        const tokenAAccount = KeetaNet.lib.Account.fromPublicKeyString(pool.tokenA);
        const tokenBAccount = KeetaNet.lib.Account.fromPublicKeyString(pool.tokenB);

        // Build TX1: User sends tokenA + tokenB to pool
        console.log('📝 Building TX1 (user sends tokens to pool)...');
        const tx1Builder = userClient.initBuilder();

        // Send tokenA to pool
        tx1Builder.send(pool.poolAddress, amountAAtomic, tokenAAccount);

        // Send tokenB to pool
        tx1Builder.send(pool.poolAddress, amountBAtomic, tokenBAccount);

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

        // Call backend to execute TX2 (mint LP tokens to user)
        console.log('📝 Calling backend to execute TX2 (mint LP tokens)...');
        const tx2Response = await fetch(`${API_BASE}/liquidity/keythings/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userAddress: wallet.address,
            poolAddress: pool.poolAddress,
            tokenA: pool.tokenA,
            tokenB: pool.tokenB,
            amountA: amountAAtomic.toString(),
            amountB: amountBAtomic.toString(),
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
          title: "Liquidity Added!",
          description: (
            <div className="space-y-1">
              <div>Added {liqAmountA} {pool.symbolA} and {liqAmountB} {pool.symbolB}</div>
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
        setLiqAmountA("");
        setLiqAmountB("");

        // Wait for blockchain to sync before refreshing
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Refresh data
        await refreshBalances();
        await loadPools();
        await fetchPositions();

      } else {
        // Seed wallet: Traditional single-endpoint flow
        console.log('💧 Executing seed wallet add liquidity via backend API...');

        // Execute add liquidity - user sends tokens, OPS handles LP token creation
        const result = await addLiquidityClient(
          wallet.seed,
          selectedPoolForLiq,
          pool.tokenA,
          pool.tokenB,
          liqAmountA,
          liqAmountB,
          pool.decimalsA || 9,
          pool.decimalsB || 9,
          wallet.accountIndex || 0
        );

        if (result.success) {
          // Build explorer link
          const explorerUrl = result.blockHash
            ? `https://explorer.test.keeta.com/block/${result.blockHash}`
            : `https://explorer.test.keeta.com/account/${wallet.address}`;

          toast({
            title: "Liquidity Added!",
            description: (
              <div className="space-y-1">
                <div>Added {result.amountA} {pool.symbolA} and {result.amountB} {pool.symbolB}</div>
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
          setLiqAmountA("");
          setLiqAmountB("");

          // Wait for blockchain to sync before refreshing
          await new Promise(resolve => setTimeout(resolve, 2000));

          // Refresh data
          await refreshBalances();
          await loadPools();
          await fetchPositions();
        } else {
          throw new Error(result.error || "Failed to add liquidity");
        }
      }
    } catch (error: any) {
      toast({
        title: "Add Liquidity Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setAddingLiq(false);
    }
  }

  /**
   * Add liquidity directly with pool data (for newly created pools)
   * This bypasses the pools array which filters out empty pools
   */
  async function addLiquidityDirect(poolAddress: string, tokenA: string, tokenB: string, amountA: string, amountB: string) {
    if (!wallet || !poolAddress || !amountA || !amountB) {
      console.log('❌ Missing required data for addLiquidityDirect');
      return;
    }

    setAddingLiq(true);
    try {
      console.log('💧 Adding liquidity directly (bypassing pools array)...');
      console.log(`  Pool: ${poolAddress.slice(0, 20)}...`);
      console.log(`  Token A: ${tokenA.slice(0, 20)}...`);
      console.log(`  Token B: ${tokenB.slice(0, 20)}...`);
      console.log(`  Amount A: ${amountA}`);
      console.log(`  Amount B: ${amountB}`);

      // Check if this is a Keythings wallet
      if (wallet.isKeythings) {
        console.log('💧 Executing Keythings add liquidity (two-transaction flow)...');

        // Import utilities
        const { toAtomic } = await import('@/lib/keeta-swap-math');
        const { getKeythingsProvider } = await import('@/lib/keythings-provider');

        // Get Keythings user client for transaction signing
        const provider = getKeythingsProvider();
        if (!provider) {
          throw new Error('Keythings provider not found');
        }

        console.log('🔐 Requesting user client from Keythings...');
        const userClient = await provider.getUserClient();

        // Helper function to fetch token decimals from Keeta RPC
        async function fetchTokenDecimals(tokenAddress: string): Promise<number> {
          const response = await fetch('https://api.test.keeta.com/rpc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'getAccountsInfo',
              params: { accounts: [tokenAddress] }
            })
          });
          const data = await response.json();
          const tokenInfo = data.result?.accounts?.[tokenAddress];
          if (!tokenInfo?.info?.metadata) {
            throw new Error(`Could not fetch metadata for token ${tokenAddress}`);
          }
          // Decode base64 metadata (browser-compatible)
          const metadataJson = atob(tokenInfo.info.metadata);
          const metadata = JSON.parse(metadataJson);
          return metadata.decimals || 9; // Default to 9 if not specified
        }

        // Fetch actual decimals for both tokens
        console.log('🔍 Fetching token decimals...');
        const [decimalsA, decimalsB] = await Promise.all([
          fetchTokenDecimals(tokenA),
          fetchTokenDecimals(tokenB),
        ]);
        console.log(`  Token A decimals: ${decimalsA}`);
        console.log(`  Token B decimals: ${decimalsB}`);

        // Convert amounts to atomic units using actual decimals
        const amountAAtomic = toAtomic(parseFloat(amountA), decimalsA);
        const amountBAtomic = toAtomic(parseFloat(amountB), decimalsB);

        console.log('💰 Liquidity amounts:', {
          amountA: amountAAtomic.toString(),
          amountB: amountBAtomic.toString(),
        });

        // Import KeetaNet for account creation
        const KeetaNet = await import('@keetanetwork/keetanet-client');
        const tokenAAccount = KeetaNet.lib.Account.fromPublicKeyString(tokenA);
        const tokenBAccount = KeetaNet.lib.Account.fromPublicKeyString(tokenB);

        // Build TX1: User sends tokenA + tokenB to pool
        console.log('📝 Building TX1 (user sends tokens to pool)...');
        const tx1Builder = userClient.initBuilder();

        // Send tokenA to pool
        tx1Builder.send(poolAddress, amountAAtomic, tokenAAccount);

        // Send tokenB to pool
        tx1Builder.send(poolAddress, amountBAtomic, tokenBAccount);

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

        // Call backend to execute TX2 (mint LP tokens to user)
        console.log('📝 Calling backend to execute TX2 (mint LP tokens)...');
        const tx2Response = await fetch(`${API_BASE}/liquidity/keythings/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userAddress: wallet.address,
            poolAddress: poolAddress,
            tokenA: tokenA,
            tokenB: tokenB,
            amountA: amountAAtomic.toString(),
            amountB: amountBAtomic.toString(),
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
          title: "Liquidity Added!",
          description: (
            <div className="space-y-1">
              <div>Added {amountA} + {amountB} to pool</div>
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

        // Wait for blockchain to sync before refreshing
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Refresh data
        await refreshBalances();
        await loadPools();
        await fetchPositions();

      } else {
        throw new Error('Seed wallet flow not implemented for addLiquidityDirect');
      }
    } catch (error: any) {
      toast({
        title: "Add Liquidity Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setAddingLiq(false);
      // Clear form after completion
      setNewPoolTokenA("");
      setNewPoolTokenB("");
      setLiqAmountA("");
      setLiqAmountB("");
      setCreateMode(false);
    }
  }

  async function removeLiquidity(position: any) {
    if (!wallet) return;

    setRemovingLiq(true);
    try {
      // Check if this is a Keythings wallet
      if (wallet.isKeythings) {
        console.log('🔥 Executing Keythings remove liquidity (two-transaction flow)...');

        // Import utilities
        console.log('📦 Importing Keythings provider...');
        const { getKeythingsProvider } = await import('@/lib/keythings-provider');

        // Get Keythings user client for transaction signing
        console.log('🔍 Getting Keythings provider instance...');
        const provider = getKeythingsProvider();
        if (!provider) {
          throw new Error('Keythings provider not found');
        }

        console.log('🔐 Requesting user client from Keythings...');
        const userClient = await provider.getUserClient();

        // Calculate LP amount to burn based on percentage
        const lpTotalAmount = BigInt(position.liquidity);
        const lpAmountToBurn = (lpTotalAmount * BigInt(removeLiqPercent)) / 100n;

        console.log('💎 LP amount to burn:', {
          total: lpTotalAmount.toString(),
          percent: removeLiqPercent,
          toBurn: lpAmountToBurn.toString(),
        });

        // Import KeetaNet for account creation
        const KeetaNet = await import('@keetanetwork/keetanet-client');
        const lpTokenAccount = KeetaNet.lib.Account.fromPublicKeyString(position.lpTokenAddress);

        // Build TX1: User sends LP tokens to LP token account for burning
        console.log('📝 Building TX1 (user sends LP tokens to LP token account)...');
        const tx1Builder = userClient.initBuilder();

        // Send LP tokens to LP token account (backend will burn them from there)
        tx1Builder.send(position.lpTokenAddress, lpAmountToBurn, lpTokenAccount);

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

        // Call backend to execute TX2 (burn LP tokens and return tokenA + tokenB to user)
        console.log('📝 Calling backend to execute TX2 (burn LP and return tokens)...');
        const tx2Response = await fetch(`${API_BASE}/liquidity/keythings/remove-complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userAddress: wallet.address,
            poolAddress: position.poolAddress,
            lpTokenAddress: position.lpTokenAddress,
            lpAmount: lpAmountToBurn.toString(),
            amountAMin: '0', // TODO: Add slippage protection
            amountBMin: '0',
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
          title: "Liquidity Removed!",
          description: (
            <div className="space-y-1">
              <div>Removed {removeLiqPercent}% of your liquidity</div>
              <div className="text-sm text-muted-foreground">
                Received {tx2Result.result.amountA} {position.symbolA} and {tx2Result.result.amountB} {position.symbolB}
              </div>
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

        // Wait for blockchain to sync before refreshing
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Refresh data
        await refreshBalances();
        await loadPools();
        await fetchPositions();
      } else {
        // Regular wallet: use seed-based client
        console.log('🔥 Removing liquidity with client-side transaction signing...');

        // Execute remove liquidity using client-side implementation
        const result = await removeLiquidityClient(
          wallet.seed,
          position.poolAddress,
          position.tokenA,
          position.tokenB,
          removeLiqPercent,
          position.liquidity,
          wallet.accountIndex || 0
        );

        if (result.success) {
          // Build explorer link
          const explorerUrl = result.blockHash
            ? `https://explorer.test.keeta.com/block/${result.blockHash}`
            : `https://explorer.test.keeta.com/account/${wallet.address}`;

          toast({
            title: "Liquidity Removed!",
            description: (
              <div className="space-y-1">
                <div>Removed {removeLiqPercent}% of your liquidity</div>
                <div className="text-sm text-muted-foreground">
                  Received {result.amountA} {position.symbolA} and {result.amountB} {position.symbolB}
                </div>
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

          // Wait for blockchain to sync before refreshing
          await new Promise(resolve => setTimeout(resolve, 2000));

          // Refresh data
          await refreshBalances();
          await loadPools();
          await fetchPositions();
        } else {
          throw new Error(result.error || "Failed to remove liquidity");
        }
      }
    } catch (error: any) {
      console.error('❌ Remove liquidity error:', error);
      toast({
        title: "Remove Liquidity Failed",
        description: error.message || 'Unknown error occurred',
        variant: "destructive",
      });
    } finally {
      setRemovingLiq(false);
    }
  }

  return (
    <div className="min-h-[calc(100vh-4rem)]">
      <div className="container py-10">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold mb-2">Liquidity Pools</h1>
          <p className="text-muted-foreground text-sm">
            Add liquidity to earn fees on every swap
          </p>
        </div>

        <div className="mx-auto max-w-3xl glass-card-elevated rounded-2xl p-6">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setCreateMode(false)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
                  !createMode
                    ? "bg-gradient-to-br from-white/20 to-white/10 border border-white/20 text-white shadow-sm"
                    : "bg-secondary/60 hover:bg-secondary/80"
                }`}
              >
                Add Liquidity
              </button>
              <button
                onClick={() => setCreateMode(true)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
                  createMode
                    ? "bg-gradient-to-br from-white/20 to-white/10 border border-white/20 text-white shadow-sm"
                    : "bg-secondary/60 hover:bg-secondary/80"
                }`}
              >
                Create Pool
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {!createMode ? (
                  // Select Existing Pool Mode
                  <div className="rounded-lg bg-secondary/40 p-3">
                    <label className="text-xs text-muted-foreground mb-2 block">Select Pool</label>
                    <select
                      value={selectedPoolForLiq}
                      onChange={(e) => setSelectedPoolForLiq(e.target.value)}
                      className="w-full rounded-lg bg-card hover:bg-card/80 px-3 py-2 text-sm font-semibold border-none outline-none cursor-pointer"
                    >
                      <option value="">Choose a pool...</option>
                      {pools.map((pool) => (
                        <option key={pool.poolAddress} value={pool.poolAddress}>
                          {pool.symbolA} / {pool.symbolB}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  // Create New Pool Mode
                  <div className="space-y-3">
                    {/* Token A Input */}
                    <div className="glass-card rounded-xl p-4">
                      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                        <span>Token A</span>
                        {newPoolTokenA && wallet && (
                          <span>
                            Bal: {wallet.tokens.find(t => t.address === newPoolTokenA)?.balanceFormatted || "0"}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <select
                          value={newPoolTokenA}
                          onChange={(e) => {
                            const tokenA = e.target.value;
                            setNewPoolTokenA(tokenA);

                            if (tokenA && newPoolTokenB) {
                              const existingPool = pools.find(p =>
                                (p.tokenA === tokenA && p.tokenB === newPoolTokenB) ||
                                (p.tokenA === newPoolTokenB && p.tokenB === tokenA)
                              );

                              if (existingPool) {
                                setCreateMode(false);
                                setSelectedPoolForLiq(existingPool.poolAddress);
                                toast({
                                  title: "Pool Already Exists",
                                  description: "Switched to existing pool. Add liquidity to it instead.",
                                });
                              }
                            }
                          }}
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
                          value={liqAmountA}
                          onChange={(e) => setLiqAmountA(e.target.value.replace(",", "."))}
                          disabled={!newPoolTokenA}
                          className="ml-auto flex-1 min-w-0 bg-transparent text-right text-2xl sm:text-3xl font-semibold outline-none placeholder:text-muted-foreground/60 disabled:opacity-50"
                        />
                      </div>
                      {liqAmountA && newPoolTokenA && tokenPrices?.[newPoolTokenA]?.priceUsd && (
                        <div className="text-xs text-muted-foreground text-right mt-1">
                          ${(parseFloat(liqAmountA) * tokenPrices[newPoolTokenA].priceUsd!).toFixed(2)} USD
                        </div>
                      )}
                    </div>

                    {/* Arrow Icon */}
                    <div className="relative flex justify-center -my-2">
                      <button
                        type="button"
                        onClick={toggleLiquidityTokens}
                        className="rounded-xl border border-border/60 bg-card p-2 shadow-md hover:bg-card/80 transition-colors cursor-pointer z-10"
                      >
                        <ArrowDownUp className="h-4 w-4" />
                      </button>
                    </div>

                    {/* Token B Input */}
                    <div className="glass-card rounded-xl p-4">
                      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                        <span>Token B</span>
                        {newPoolTokenB && wallet && (
                          <span>
                            Bal: {wallet.tokens.find(t => t.address === newPoolTokenB)?.balanceFormatted || "0"}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <select
                          value={newPoolTokenB}
                          onChange={(e) => {
                            const tokenB = e.target.value;
                            setNewPoolTokenB(tokenB);

                            if (newPoolTokenA && tokenB) {
                              const existingPool = pools.find(p =>
                                (p.tokenA === newPoolTokenA && p.tokenB === tokenB) ||
                                (p.tokenA === tokenB && p.tokenB === newPoolTokenA)
                              );

                              if (existingPool) {
                                setCreateMode(false);
                                setSelectedPoolForLiq(existingPool.poolAddress);
                                toast({
                                  title: "Pool Already Exists",
                                  description: "Switched to existing pool. Add liquidity to it instead.",
                                });
                              }
                            }
                          }}
                          disabled={!newPoolTokenA}
                          className="min-w-24 sm:min-w-28 shrink-0 rounded-lg bg-card hover:bg-card/80 px-3 py-2 text-sm font-semibold border-none outline-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <option value="">Select</option>
                          {wallet?.tokens
                            .filter((token) => token.address !== newPoolTokenA)
                            .map((token) => (
                              <option key={token.address} value={token.address}>
                                {token.symbol}
                              </option>
                            ))}
                        </select>
                        <input
                          inputMode="decimal"
                          pattern="^[0-9]*[.,]?[0-9]*$"
                          placeholder="0.00"
                          value={liqAmountB}
                          onChange={(e) => setLiqAmountB(e.target.value.replace(",", "."))}
                          disabled={!newPoolTokenB}
                          className="ml-auto flex-1 min-w-0 bg-transparent text-right text-2xl sm:text-3xl font-semibold outline-none placeholder:text-muted-foreground/60 disabled:opacity-50"
                        />
                      </div>
                      {liqAmountB && newPoolTokenB && tokenPrices?.[newPoolTokenB]?.priceUsd && (
                        <div className="text-xs text-muted-foreground text-right mt-1">
                          ${(parseFloat(liqAmountB) * tokenPrices[newPoolTokenB].priceUsd!).toFixed(2)} USD
                        </div>
                      )}
                    </div>

                    <Button
                      onClick={!wallet ? connectKeythingsWallet : createPool}
                      disabled={wallet ? (creatingPool || !newPoolTokenA || !newPoolTokenB || !liqAmountA || !liqAmountB) : loading}
                      className="w-full h-12 text-base font-semibold bg-gradient-to-br from-white/20 to-white/10 hover:from-white/30 hover:to-white/20 border border-white/20 text-white crisp-button mono-glow disabled:opacity-50"
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
                      ) : creatingPool ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Creating Pool...
                        </>
                      ) : (
                        "Create Pool & Add Liquidity"
                      )}
                    </Button>
                  </div>
                )}

                {!createMode && selectedPoolForLiq && (() => {
                  const pool = pools.find((p) => p.poolAddress === selectedPoolForLiq);
                  if (!pool) return null;

                  return (
                    <>
                      {/* Token A Input */}
                      <div className="glass-card rounded-xl p-4">
                        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                          <span>{pool.symbolA || ''}</span>
                          {wallet && (
                            <span>
                              Bal: {wallet.tokens.find(t => t.address === pool.tokenA)?.balanceFormatted || "0"}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="min-w-24 sm:min-w-28 shrink-0 rounded-lg bg-card px-3 py-2 text-sm font-semibold">
                            {pool.symbolA || ''}
                          </div>
                          <input
                            inputMode="decimal"
                            pattern="^[0-9]*[.,]?[0-9]*$"
                            placeholder="0.00"
                            value={liqAmountA}
                            onChange={(e) => {
                              const value = e.target.value.replace(",", ".");
                              setLiqAmountA(value);
                              if (value && pool && pool.reserveAHuman && pool.reserveBHuman) {
                                const amountA = parseFloat(value);
                                if (!isNaN(amountA) && amountA > 0) {
                                  const ratio = pool.reserveBHuman / pool.reserveAHuman;
                                  const amountB = (amountA * ratio).toFixed(6);
                                  setLiqAmountB(amountB);
                                }
                              } else if (!value) {
                                setLiqAmountB("");
                              }
                            }}
                            className="ml-auto flex-1 min-w-0 bg-transparent text-right text-2xl sm:text-3xl font-semibold outline-none placeholder:text-muted-foreground/60"
                          />
                        </div>
                        {liqAmountA && pool.tokenA && tokenPrices?.[pool.tokenA]?.priceUsd && (
                          <div className="text-xs text-muted-foreground text-right mt-1">
                            ${(parseFloat(liqAmountA) * tokenPrices[pool.tokenA].priceUsd!).toFixed(2)} USD
                          </div>
                        )}
                      </div>

                      {/* Arrow Icon */}
                      <div className="relative flex justify-center -my-2">
                        <div className="rounded-xl border border-border/60 bg-card p-2 shadow-md">
                          <ArrowDownUp className="h-4 w-4" />
                        </div>
                      </div>

                      {/* Token B Input */}
                      <div className="glass-card rounded-xl p-4">
                        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                          <span>{pool.symbolB || ''}</span>
                          {wallet && (
                            <span>
                              Bal: {wallet.tokens.find(t => t.address === pool.tokenB)?.balanceFormatted || "0"}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="min-w-24 sm:min-w-28 shrink-0 rounded-lg bg-card px-3 py-2 text-sm font-semibold">
                            {pool.symbolB || ''}
                          </div>
                          <input
                            inputMode="decimal"
                            pattern="^[0-9]*[.,]?[0-9]*$"
                            placeholder="0.00"
                            value={liqAmountB}
                            onChange={(e) => setLiqAmountB(e.target.value.replace(",", "."))}
                            className="ml-auto flex-1 min-w-0 bg-transparent text-right text-2xl sm:text-3xl font-semibold outline-none placeholder:text-muted-foreground/60"
                          />
                        </div>
                        {liqAmountB && pool.tokenB && tokenPrices?.[pool.tokenB]?.priceUsd && (
                          <div className="text-xs text-muted-foreground text-right mt-1">
                            ${(parseFloat(liqAmountB) * tokenPrices[pool.tokenB].priceUsd!).toFixed(2)} USD
                          </div>
                        )}
                      </div>

                      {/* Pool Info */}
                      {liqAmountA && liqAmountB && (
                        <div className="rounded-lg bg-secondary/40 p-3 space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Pool Ratio</span>
                            <span className="font-medium">
                              1 {pool.symbolA} = {(Number(pool.reserveBHuman) / Number(pool.reserveAHuman)).toFixed(6)} {pool.symbolB}
                            </span>
                          </div>
                        </div>
                      )}

                      <Button
                        onClick={!wallet ? connectKeythingsWallet : addLiquidity}
                        disabled={wallet ? (addingLiq || !liqAmountA || !liqAmountB) : loading}
                        className="w-full h-12 text-base font-semibold bg-gradient-to-br from-white/20 to-white/10 hover:from-white/30 hover:to-white/20 border border-white/20 text-white crisp-button mono-glow disabled:opacity-50"
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
                        ) : addingLiq ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Adding Liquidity...
                          </>
                        ) : (
                          "Add Liquidity"
                        )}
                      </Button>
                    </>
                  );
                })()}
          </div>
        </div>

        {/* Active Pools Section */}
        <div className="mt-10">
          {/* Dashboard Stats */}
          <PoolDashboard
            totalTVL={dashboardStats.totalTVL}
            totalPools={dashboardStats.totalPools}
            totalVolume24h={dashboardStats.totalVolume24h}
            avgAPY={dashboardStats.avgAPY}
          />

          <div className="mt-6">
            {allPools.length === 0 ? (
              <div className="glass-card-elevated rounded-2xl p-12 text-center text-muted-foreground">
                <Droplets className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No pools yet. Be the first to create one!</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {allPools.map((pool) => {
                  // Find user's position in this pool
                  const userPosition = positions.find(
                    (p) => p.poolAddress === pool.poolAddress
                  );

                  // Convert to KeetaPoolCardData format
                  const poolCardData: KeetaPoolCardData = {
                    poolAddress: pool.poolAddress,
                    tokenA: pool.tokenA,
                    tokenB: pool.tokenB,
                    symbolA: pool.symbolA,
                    symbolB: pool.symbolB,
                    reserveA: pool.reserveA,
                    reserveB: pool.reserveB,
                    reserveAHuman: pool.reserveAHuman,
                    reserveBHuman: pool.reserveBHuman,
                    decimalsA: pool.decimalsA || 9,
                    decimalsB: pool.decimalsB || 9,
                    totalShares: pool.totalShares,
                    userPosition: userPosition
                      ? {
                          shares: userPosition.liquidity,
                          sharePercent: userPosition.sharePercent,
                          amountA: userPosition.amountA,
                          amountB: userPosition.amountB,
                        }
                      : undefined,
                  };

                  return (
                    <KeetaPoolCard
                      key={pool.poolAddress}
                      pool={poolCardData}
                      onManage={(selectedPool) => {
                        setSelectedPoolForLiq(selectedPool.poolAddress);
                        setCreateMode(false);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                      onRemoveLiquidity={async (selectedPool, percent) => {
                        const position = positions.find(
                          (p) => p.poolAddress === selectedPool.poolAddress
                        );
                        if (!position) return;

                        setRemoveLiqPercent(percent);
                        await removeLiquidity(position);
                      }}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
