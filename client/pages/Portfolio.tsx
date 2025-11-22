import React, { useEffect, useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { formatUnits, parseUnits } from "viem";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { v2Addresses, v2Abi } from "@/amm/v2";
import { v3Addresses, nfpmAbi } from "@/amm/v3";
import { toast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2, DollarSign } from "lucide-react";
import { BridgeFromBase } from "@/components/Bridge/BridgeFromBase";
import { useKeetaWallet } from "@/contexts/KeetaWalletContext";
import "@/styles/bridge.css";

type V2Position = {
  pairAddress: string;
  token0: string;
  token1: string;
  token0Symbol: string;
  token1Symbol: string;
  lpBalance: bigint;
  token0Amount: bigint;
  token1Amount: bigint;
  poolShare: number;
};

type V3Position = {
  tokenId: bigint;
  token0: string;
  token1: string;
  token0Symbol: string;
  token1Symbol: string;
  fee: number;
  liquidity: bigint;
  tickLower: number;
  tickUpper: number;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
};

const PAIR_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getReserves",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "reserve0", type: "uint112" },
      { name: "reserve1", type: "uint112" },
      { name: "blockTimestampLast", type: "uint32" },
    ],
  },
  {
    type: "function",
    name: "token0",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "token1",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

const ERC20_ABI = [
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const FACTORY_ABI = [
  {
    type: "function",
    name: "allPairs",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "allPairsLength",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

// Use router ABI from v2.ts

export default function Portfolio() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { wallet: keetaWallet, refreshBalances } = useKeetaWallet();

  const [v2Positions, setV2Positions] = useState<V2Position[]>([]);
  const [v3Positions, setV3Positions] = useState<V3Position[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"v2" | "v3">("v2");

  // Fetch V2 positions
  useEffect(() => {
    let cancel = false;

    async function fetchV2Positions() {
      if (!publicClient || !address || !isConnected) {
        setV2Positions([]);
        return;
      }

      const addrs = v2Addresses();
      if (!addrs) return;

      setLoading(true);
      try {
        // Get all pairs from factory
        const pairCount = (await publicClient.readContract({
          address: addrs.factory,
          abi: FACTORY_ABI,
          functionName: "allPairsLength",
        })) as bigint;

        const positions: V2Position[] = [];

        // Check each pair for user's LP balance
        for (let i = 0; i < Number(pairCount); i++) {
          if (cancel) return;

          const pairAddress = (await publicClient.readContract({
            address: addrs.factory,
            abi: FACTORY_ABI,
            functionName: "allPairs",
            args: [BigInt(i)],
          })) as `0x${string}`;

          // Check LP balance
          const lpBalance = (await publicClient.readContract({
            address: pairAddress,
            abi: PAIR_ABI,
            functionName: "balanceOf",
            args: [address],
          })) as bigint;

          if (lpBalance === 0n) continue;

          // Get pair details
          const [token0, token1, totalSupply, reserves] = await Promise.all([
            publicClient.readContract({
              address: pairAddress,
              abi: PAIR_ABI,
              functionName: "token0",
            }) as Promise<`0x${string}`>,
            publicClient.readContract({
              address: pairAddress,
              abi: PAIR_ABI,
              functionName: "token1",
            }) as Promise<`0x${string}`>,
            publicClient.readContract({
              address: pairAddress,
              abi: PAIR_ABI,
              functionName: "totalSupply",
            }) as Promise<bigint>,
            publicClient.readContract({
              address: pairAddress,
              abi: PAIR_ABI,
              functionName: "getReserves",
            }) as Promise<[bigint, bigint, number]>,
          ]);

          // Get token symbols
          const [token0Symbol, token1Symbol] = await Promise.all([
            publicClient.readContract({
              address: token0,
              abi: ERC20_ABI,
              functionName: "symbol",
            }) as Promise<string>,
            publicClient.readContract({
              address: token1,
              abi: ERC20_ABI,
              functionName: "symbol",
            }) as Promise<string>,
          ]);

          const [reserve0, reserve1] = reserves;

          // Calculate user's share
          const poolShare = Number((lpBalance * 10000n) / totalSupply) / 100;
          const token0Amount = (reserve0 * lpBalance) / totalSupply;
          const token1Amount = (reserve1 * lpBalance) / totalSupply;

          positions.push({
            pairAddress,
            token0,
            token1,
            token0Symbol,
            token1Symbol,
            lpBalance,
            token0Amount,
            token1Amount,
            poolShare,
          });
        }

        if (!cancel) {
          setV2Positions(positions);
        }
      } catch (error) {
        console.error("Error fetching V2 positions:", error);
      } finally {
        if (!cancel) setLoading(false);
      }
    }

    fetchV2Positions();
    return () => {
      cancel = true;
    };
  }, [publicClient, address, isConnected]);

  // Fetch V3 positions
  useEffect(() => {
    let cancel = false;

    async function fetchV3Positions() {
      if (!publicClient || !address || !isConnected) {
        setV3Positions([]);
        return;
      }

      const addrs = v3Addresses();
      if (!addrs) return;

      setLoading(true);
      try {
        // Get number of NFT positions owned by user
        const balance = (await publicClient.readContract({
          address: addrs.nfpm,
          abi: nfpmAbi,
          functionName: "balanceOf",
          args: [address],
        })) as bigint;

        const positions: V3Position[] = [];

        // Fetch each position
        for (let i = 0; i < Number(balance); i++) {
          if (cancel) return;

          // Get token ID
          const tokenId = (await publicClient.readContract({
            address: addrs.nfpm,
            abi: nfpmAbi,
            functionName: "tokenOfOwnerByIndex",
            args: [address, BigInt(i)],
          })) as bigint;

          // Get position details
          const positionData = (await publicClient.readContract({
            address: addrs.nfpm,
            abi: nfpmAbi,
            functionName: "positions",
            args: [tokenId],
          })) as any;

          // Skip positions with no liquidity
          if (positionData[7] === 0n) continue;

          const [
            nonce,
            operator,
            token0,
            token1,
            fee,
            tickLower,
            tickUpper,
            liquidity,
            feeGrowthInside0LastX128,
            feeGrowthInside1LastX128,
            tokensOwed0,
            tokensOwed1,
          ] = positionData;

          // Get token symbols
          const [token0Symbol, token1Symbol] = await Promise.all([
            publicClient.readContract({
              address: token0 as `0x${string}`,
              abi: ERC20_ABI,
              functionName: "symbol",
            }) as Promise<string>,
            publicClient.readContract({
              address: token1 as `0x${string}`,
              abi: ERC20_ABI,
              functionName: "symbol",
            }) as Promise<string>,
          ]);

          positions.push({
            tokenId,
            token0,
            token1,
            token0Symbol,
            token1Symbol,
            fee: Number(fee),
            liquidity,
            tickLower,
            tickUpper,
            tokensOwed0,
            tokensOwed1,
          });
        }

        if (!cancel) {
          setV3Positions(positions);
        }
      } catch (error) {
        console.error("Error fetching V3 positions:", error);
      } finally {
        if (!cancel) setLoading(false);
      }
    }

    fetchV3Positions();
    return () => {
      cancel = true;
    };
  }, [publicClient, address, isConnected]);

  async function handleRemoveV2Liquidity(position: V2Position, percentage: number) {
    if (!publicClient || !address) return;

    const addrs = v2Addresses();
    if (!addrs) return;

    try {
      const liquidityToRemove = (position.lpBalance * BigInt(percentage)) / 100n;

      // Fetch fresh reserves to calculate correct minimum amounts
      const reserves = await publicClient.readContract({
        address: position.pairAddress as `0x${string}`,
        abi: PAIR_ABI,
        functionName: "getReserves",
      }) as any;

      const totalSupply = await publicClient.readContract({
        address: position.pairAddress as `0x${string}`,
        abi: PAIR_ABI,
        functionName: "totalSupply",
      }) as bigint;

      // Calculate expected amounts based on current reserves
      const reserve0 = BigInt(reserves[0]);
      const reserve1 = BigInt(reserves[1]);
      const amount0Expected = (liquidityToRemove * reserve0) / totalSupply;
      const amount1Expected = (liquidityToRemove * reserve1) / totalSupply;

      // Apply 5% slippage to expected amounts
      const amount0Min = (amount0Expected * 95n) / 100n;
      const amount1Min = (amount1Expected * 95n) / 100n;

      console.log("Liquidity removal calculation:", {
        liquidityToRemove: liquidityToRemove.toString(),
        totalSupply: totalSupply.toString(),
        reserve0: reserve0.toString(),
        reserve1: reserve1.toString(),
        amount0Expected: amount0Expected.toString(),
        amount1Expected: amount1Expected.toString(),
        amount0Min: amount0Min.toString(),
        amount1Min: amount1Min.toString(),
      });
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300); // 5 minutes

      // Approve router to spend LP tokens
      toast({
        title: "Approving LP tokens...",
        description: "Please confirm the approval transaction",
      });

      const approveTx = await writeContractAsync({
        address: position.pairAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [addrs.router, liquidityToRemove],
      });

      await publicClient.waitForTransactionReceipt({ hash: approveTx as `0x${string}` });

      toast({
        title: "Removing liquidity...",
        description: "Please confirm the transaction",
      });

      // Remove liquidity
      const tx = await writeContractAsync({
        address: addrs.router,
        abi: v2Abi.router,
        functionName: "removeLiquidity",
        args: [
          position.token0 as `0x${string}`,
          position.token1 as `0x${string}`,
          liquidityToRemove,
          amount0Min,
          amount1Min,
          address,
          deadline,
        ],
      });

      const explorerUrl = `https://basescan.org/tx/${tx}`;
      toast({
        title: "Transaction Submitted",
        description: (
          <div className="flex flex-col gap-1">
            <span>Waiting for confirmation...</span>
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-400 underline text-xs"
            >
              View on Basescan
            </a>
          </div>
        ),
      });

      await publicClient.waitForTransactionReceipt({ hash: tx as `0x${string}` });

      toast({
        title: "Liquidity Removed!",
        description: (
          <div className="flex flex-col gap-1">
            <span>Successfully removed {percentage}% of your liquidity</span>
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-400 underline text-xs"
            >
              View on Basescan
            </a>
          </div>
        ),
      });

      // Refresh positions
      window.location.reload();
    } catch (error: any) {
      console.error("Remove liquidity error:", error);
      toast({
        title: "Remove Liquidity Failed",
        description: error?.shortMessage || error?.message || String(error),
        variant: "destructive",
      });
    }
  }

  async function handleCollectV3Fees(position: V3Position) {
    if (!publicClient || !address) return;

    const addrs = v3Addresses();
    if (!addrs) return;

    try {
      toast({
        title: "Collecting Fees...",
        description: "Please confirm the transaction",
      });

      const MAX_UINT128 = 2n ** 128n - 1n;

      const tx = await writeContractAsync({
        address: addrs.nfpm,
        abi: nfpmAbi,
        functionName: "collect",
        args: [
          {
            tokenId: position.tokenId,
            recipient: address,
            amount0Max: MAX_UINT128,
            amount1Max: MAX_UINT128,
          },
        ],
      });

      const explorerUrl = `https://basescan.org/tx/${tx}`;
      toast({
        title: "Transaction Submitted",
        description: (
          <div className="flex flex-col gap-1">
            <span>Collecting fees...</span>
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-400 underline text-xs"
            >
              View on Basescan
            </a>
          </div>
        ),
      });

      await publicClient.waitForTransactionReceipt({ hash: tx as `0x${string}` });

      toast({
        title: "Fees Collected!",
        description: (
          <div className="flex flex-col gap-1">
            <span>Successfully collected your fees</span>
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-400 underline text-xs"
            >
              View on Basescan
            </a>
          </div>
        ),
      });

      window.location.reload();
    } catch (error: any) {
      console.error("Collect fees error:", error);
      toast({
        title: "Collect Fees Failed",
        description: error?.shortMessage || error?.message || String(error),
        variant: "destructive",
      });
    }
  }

  async function handleRemoveV3Liquidity(position: V3Position, percentage: number) {
    if (!publicClient || !address) return;

    const addrs = v3Addresses();
    if (!addrs) return;

    try {
      const liquidityToRemove = (position.liquidity * BigInt(percentage)) / 100n;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300); // 5 minutes

      toast({
        title: "Removing Liquidity...",
        description: "Please confirm the transaction",
      });

      // Decrease liquidity
      const tx = await writeContractAsync({
        address: addrs.nfpm,
        abi: nfpmAbi,
        functionName: "decreaseLiquidity",
        args: [
          {
            tokenId: position.tokenId,
            liquidity: liquidityToRemove as any,
            amount0Min: 0n, // Accept any amount (5% slippage built into quote)
            amount1Min: 0n,
            deadline,
          },
        ],
      });

      const explorerUrl = `https://basescan.org/tx/${tx}`;
      toast({
        title: "Transaction Submitted",
        description: (
          <div className="flex flex-col gap-1">
            <span>Waiting for confirmation...</span>
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-400 underline text-xs"
            >
              View on Basescan
            </a>
          </div>
        ),
      });

      await publicClient.waitForTransactionReceipt({ hash: tx as `0x${string}` });

      // Now collect the tokens
      const MAX_UINT128 = 2n ** 128n - 1n;
      const collectTx = await writeContractAsync({
        address: addrs.nfpm,
        abi: nfpmAbi,
        functionName: "collect",
        args: [
          {
            tokenId: position.tokenId,
            recipient: address,
            amount0Max: MAX_UINT128,
            amount1Max: MAX_UINT128,
          },
        ],
      });

      await publicClient.waitForTransactionReceipt({ hash: collectTx as `0x${string}` });

      // If 100%, burn the NFT
      if (percentage === 100) {
        const burnTx = await writeContractAsync({
          address: addrs.nfpm,
          abi: nfpmAbi,
          functionName: "burn",
          args: [position.tokenId],
        });
        await publicClient.waitForTransactionReceipt({ hash: burnTx as `0x${string}` });
      }

      toast({
        title: "Liquidity Removed!",
        description: (
          <div className="flex flex-col gap-1">
            <span>Successfully removed {percentage}% of your liquidity</span>
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-400 underline text-xs"
            >
              View on Basescan
            </a>
          </div>
        ),
      });

      window.location.reload();
    } catch (error: any) {
      console.error("Remove V3 liquidity error:", error);
      toast({
        title: "Remove Liquidity Failed",
        description: error?.shortMessage || error?.message || String(error),
        variant: "destructive",
      });
    }
  }

  return (
    <div className="container py-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Liquidity Management</h1>
          <p className="mt-2 text-muted-foreground">
            Manage your liquidity positions across Silverback V2 and V3 pools
          </p>
        </div>

        {/* Base to Keeta Bridge */}
        <div className="mb-8">
          <BridgeFromBase
            keetaAddress={keetaWallet?.address}
            onBridgeComplete={() => {
              refreshBalances?.();
              fetchV2Positions();
            }}
          />
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "v2" | "v3")}>
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="v2">V2 Positions</TabsTrigger>
            <TabsTrigger value="v3">V3 Positions</TabsTrigger>
          </TabsList>

          <TabsContent value="v2">
            {!isConnected ? (
              <Card>
                <CardContent className="pt-6">
                  <p className="text-center text-muted-foreground">
                    Connect your wallet to view your liquidity positions
                  </p>
                </CardContent>
              </Card>
            ) : loading ? (
              <Card>
                <CardContent className="pt-6 flex items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-muted-foreground">Loading positions...</span>
                </CardContent>
              </Card>
            ) : v2Positions.length === 0 ? (
              <Card>
                <CardContent className="pt-6">
                  <p className="text-center text-muted-foreground mb-4">
                    No V2 liquidity positions found
                  </p>
                  <div className="flex justify-center">
                    <Button
                      onClick={() => (window.location.href = "/pool")}
                      variant="outline"
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add Liquidity
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {v2Positions.map((position, idx) => (
                  <Card key={idx}>
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between">
                        <span>
                          {position.token0Symbol} / {position.token1Symbol}
                        </span>
                        <span className="text-sm font-normal text-muted-foreground">
                          {position.poolShare.toFixed(2)}% of pool
                        </span>
                      </CardTitle>
                      <CardDescription className="font-mono text-xs">
                        {position.pairAddress.slice(0, 6)}...{position.pairAddress.slice(-4)}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-sm text-muted-foreground">
                              {position.token0Symbol}
                            </p>
                            <p className="text-lg font-semibold">
                              {Number(formatUnits(position.token0Amount, 18)).toFixed(6)}
                            </p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">
                              {position.token1Symbol}
                            </p>
                            <p className="text-lg font-semibold">
                              {Number(formatUnits(position.token1Amount, 18)).toFixed(6)}
                            </p>
                          </div>
                        </div>

                        <div>
                          <p className="text-sm text-muted-foreground mb-2">LP Tokens</p>
                          <p className="font-mono text-sm">
                            {Number(formatUnits(position.lpBalance, 18)).toFixed(6)}
                          </p>
                        </div>

                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRemoveV2Liquidity(position, 25)}
                          >
                            Remove 25%
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRemoveV2Liquidity(position, 50)}
                          >
                            Remove 50%
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRemoveV2Liquidity(position, 75)}
                          >
                            Remove 75%
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleRemoveV2Liquidity(position, 100)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Remove All
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="v3">
            <Card>
              <CardContent className="pt-6">
                <div className="text-center py-12">
                  <h3 className="text-2xl font-semibold mb-2">Coming Soon</h3>
                  <p className="text-muted-foreground">
                    V3 concentrated liquidity positions will be available soon
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
