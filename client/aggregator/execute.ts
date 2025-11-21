import { PublicClient } from "viem";
import { base } from "viem/chains";
import { DEFAULT_DEADLINE_SEC, FEE_BPS } from "@/aggregator/config";
import { ERC20_ABI } from "@/lib/erc20";
import {
  SwapBuildResult,
  fetchOpenOceanSwapBase,
} from "@/aggregator/openocean";

export type Address = `0x${string}`;
export type TokenMeta = {
  address: Address | "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  decimals: number;
};

const NATIVE_SENTINEL = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

const UNIFIED_ROUTER_ABI = [
  {
    type: "function",
    name: "swapAndForward",
    stateMutability: "payable",
    inputs: [
      {
        name: "p",
        type: "tuple",
        components: [
          { name: "inToken", type: "address" },
          { name: "outToken", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "minAmountOut", type: "uint256" },
          { name: "to", type: "address" },
          { name: "target", type: "address" },
          { name: "data", type: "bytes" },
          { name: "deadline", type: "uint256" },
          { name: "sweep", type: "bool" },
        ],
      },
    ],
    outputs: [],
  },
] as const;

export function unifiedRouterAddress(): Address | null {
  const v = (import.meta as any).env?.VITE_SB_UNIFIED_ROUTER as
    | string
    | undefined;
  if (!v || !/^0x[a-fA-F0-9]{40}$/.test(v)) return null;
  return v as Address;
}

export async function ensureAllowance(
  pc: PublicClient,
  writeContractAsync: (args: any) => Promise<any>,
  token: Address,
  owner: Address,
  spender: Address,
  needed: bigint,
  onStatusChange?: (status: "checking" | "approving" | "confirming" | "complete") => void,
) {
  let current = 0n;
  try {
    onStatusChange?.("checking");
    current = (await pc.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [owner, spender],
    })) as bigint;
    console.log(`🔍 Current allowance: ${current.toString()}, needed: ${needed.toString()}`);
    if (current >= needed) {
      console.log("✅ Sufficient allowance already exists");
      onStatusChange?.("complete");
      return;
    }
  } catch (e) {
    console.warn("⚠️  Could not read allowance:", e);
  }

  console.log("📝 Requesting token approval...");
  onStatusChange?.("approving");

  // Some tokens (USDT, KTA, etc.) don't allow changing allowance from non-zero to non-zero
  // Reset to 0 first if current allowance is non-zero
  if (current > 0n) {
    console.log(`📝 Resetting allowance to 0 first (current: ${current.toString()})`);
    const resetHash = await writeContractAsync({
      address: token,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [spender, 0n],
    });
    console.log(`⏳ Waiting for reset transaction: ${resetHash}`);
    await pc.waitForTransactionReceipt({ hash: resetHash as `0x${string}` });
    console.log("✅ Allowance reset to 0");
  }

  const hash = await writeContractAsync({
    address: token,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [spender, needed],
  });

  console.log(`⏳ Waiting for approval transaction: ${hash}`);
  onStatusChange?.("confirming");
  await pc.waitForTransactionReceipt({ hash: hash as `0x${string}` });
  console.log("✅ Approval confirmed");
  onStatusChange?.("complete");
}

function applyFee(amountIn: bigint): { net: bigint; fee: bigint } {
  const fee = (amountIn * BigInt(FEE_BPS)) / 10_000n;
  return { net: amountIn - fee, fee };
}

const UNIFIED_ROUTER_V2_ABI = [
  {
    type: "function",
    name: "swapExactTokensForTokens",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "swapExactETHForTokens",
    stateMutability: "payable",
    inputs: [
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "swapExactTokensForETH",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
] as const;

const WETH_ADDRESS = "0x4200000000000000000000000000000000000006" as Address;

export function v2RouterAddress(): Address | null {
  const v = (import.meta as any).env?.VITE_SB_V2_ROUTER as string | undefined;
  if (!v || !/^0x[a-fA-F0-9]{40}$/.test(v)) return null;
  return v as Address;
}

export async function executeSwapViaSilverbackV2(
  pc: PublicClient,
  writeContractAsync: (args: any) => Promise<any>,
  account: Address,
  inToken: TokenMeta,
  outToken: TokenMeta,
  amountIn: bigint,
  quotedOut: bigint,
  slippageBps: number,
): Promise<{ txHash: string }> {
  // Use Silverback V2 Router for Silverback pool swaps (0.25% pair + 0.05% protocol fee)
  const router = v2RouterAddress();
  console.log("🔍 Using Silverback V2 Router address:", router);
  if (!router) throw new Error("Set VITE_SB_V2_ROUTER env to the deployed Silverback V2 Router address");

  const deadline = BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC);
  const isNativeIn = inToken.address === NATIVE_SENTINEL;
  const isNativeOut = outToken.address === NATIVE_SENTINEL;

  // Convert native sentinel to WETH for path
  const inAddr = isNativeIn ? WETH_ADDRESS : (inToken.address as Address);
  const outAddr = isNativeOut ? WETH_ADDRESS : (outToken.address as Address);
  const path = [inAddr, outAddr];

  // Silverback V2 Router collects 0.05% protocol fee + pairs collect 0.25% LP fee = 0.30% total
  // We pass full amount - router deducts fee internally

  // Calculate minOut with slippage (applied to quoted output)
  const minOut = (quotedOut * BigInt(10_000 - slippageBps)) / 10_000n;

  let hash: string;

  if (isNativeIn) {
    // ETH -> Token swap
    hash = await writeContractAsync({
      address: router,
      abi: UNIFIED_ROUTER_V2_ABI,
      functionName: "swapExactETHForTokens",
      args: [minOut, path, account, deadline],
      value: amountIn, // Full amount (no fee deduction)
      chainId: base.id,
    });
  } else if (isNativeOut) {
    // Token -> ETH swap
    const inAddrForContract = inToken.address as Address;
    console.log("🔄 Token->ETH swap params:", {
      router,
      token: inAddrForContract,
      amountIn: amountIn.toString(),
      minOut: minOut.toString(),
      path,
      account,
      deadline: deadline.toString(),
    });

    await ensureAllowance(pc, writeContractAsync, inAddrForContract, account, router, amountIn);

    hash = await writeContractAsync({
      address: router,
      abi: UNIFIED_ROUTER_V2_ABI,
      functionName: "swapExactTokensForETH",
      args: [amountIn, minOut, path, account, deadline],
      chainId: base.id,
    });
  } else {
    // Token -> Token swap
    const inAddrForContract = inToken.address as Address;
    await ensureAllowance(pc, writeContractAsync, inAddrForContract, account, router, amountIn);

    hash = await writeContractAsync({
      address: router,
      abi: UNIFIED_ROUTER_V2_ABI,
      functionName: "swapExactTokensForTokens",
      args: [amountIn, minOut, path, account, deadline],
      chainId: base.id,
    });
  }

  return { txHash: hash as string };
}

export async function executeSwapViaOpenOcean(
  pc: PublicClient,
  writeContractAsync: (args: any) => Promise<any>,
  account: Address,
  routerAddress: Address,
  inToken: TokenMeta,
  outToken: TokenMeta,
  amountIn: bigint,
  quotedOut: bigint,
  slippageBps: number,
): Promise<{ txHash: string; swapOpenOcean: SwapBuildResult | null }> {
  console.log('🚀 executeSwapViaOpenOcean called:', {
    inToken: inToken.address,
    outToken: outToken.address,
    amountIn: amountIn.toString(),
    account,
    routerAddress,
  });

  const { net, fee } = applyFee(amountIn);

  let swapOpenOcean: SwapBuildResult;
  try {
    // IMPORTANT: Pass router address to OpenOcean
    // Our router pulls tokens from user, collects fee, then calls OpenOcean
    // OpenOcean needs to build calldata that pulls tokens from the router (msg.sender to OpenOcean's contract)
    swapOpenOcean = await fetchOpenOceanSwapBase({
      inTokenAddress: inToken.address,
      outTokenAddress: outToken.address,
      amountWei: net,
      slippageBps,
      account: routerAddress, // Use router address - tokens will be in router's wallet
      gasPriceWei: await pc.getGasPrice(),
    });

    // Validate calldata length - short calldata indicates no real route exists
    // Normal swaps have 200+ bytes of calldata, stub routes have ~68 bytes
    // Convert hex string to byte length: (length - 2) / 2 (remove "0x" prefix, then divide by 2)
    const dataByteLength = (swapOpenOcean.data.length - 2) / 2;
    console.log('🔍 Checking OpenOcean calldata length:', {
      dataStringLength: swapOpenOcean.data.length,
      dataByteLength,
      data: swapOpenOcean.data,
      isShort: dataByteLength < 100,
    });

    if (dataByteLength < 100) {
      console.warn('⚠️  OpenOcean swap rejected: calldata too short (no real route)', {
        dataByteLength,
        data: swapOpenOcean.data,
      });
      throw new Error("OpenOcean: No liquidity available for this swap route");
    }
  } catch (error: any) {
    // Re-throw the error as-is so Index.tsx fallback can detect it
    throw error;
  }

  // Use OpenOcean's actual outAmount for minOut calculation, with additional buffer for execution variance
  // OpenOcean applies slippage, but we add safety margin for price movement and routing differences
  const baseMinOut = swapOpenOcean.outAmountWei && swapOpenOcean.outAmountWei > 0n
    ? swapOpenOcean.outAmountWei
    : (quotedOut * BigInt(10_000 - slippageBps)) / 10_000n;

  // Apply 15% additional buffer to prevent reverts from price movements and aggregator variance
  // Aggregator quotes are estimates - actual output can vary significantly based on liquidity and routing at execution time
  // Increased from 5% to 15% to handle volatile/illiquid tokens better
  const minOut = (baseMinOut * 8500n) / 10_000n;

  console.log("🔍 OpenOcean swap execution params:", {
    amountIn: amountIn.toString(),
    net: net.toString(),
    fee: fee.toString(),
    quotedOut: quotedOut.toString(),
    openOceanOutAmountWei: swapOpenOcean.outAmountWei?.toString(),
    calculatedMinOut: minOut.toString(),
    slippageBps,
    target: swapOpenOcean.to,
  });

  const deadline = BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC);
  const isNative = inToken.address === NATIVE_SENTINEL;
  const inAddrForContract = isNative ? (ZERO_ADDRESS as Address) : (inToken.address as Address);

  if (!isNative) {
    await ensureAllowance(pc, writeContractAsync, inAddrForContract, account, routerAddress, amountIn);
  }

  const hash = await writeContractAsync({
    address: routerAddress,
    abi: UNIFIED_ROUTER_ABI,
    functionName: "swapAndForward",
    args: [
      {
        inToken: inAddrForContract,
        outToken: outToken.address as Address,
        amountIn,
        minAmountOut: minOut,
        to: account,
        target: swapOpenOcean.to,
        data: swapOpenOcean.data,
        deadline,
        sweep: true,
      },
    ],
    value: isNative ? amountIn : 0n, // Send full amount - router deducts fee internally
    chainId: base.id,
  });

  return { txHash: hash as string, swapOpenOcean };
}

// Direct OpenOcean integration for Token → ETH and Token → Token swaps
// NO FEE COLLECTION - user calls OpenOcean directly
// Use this when router-based fee collection breaks (ERC20 input swaps)
export async function executeSwapDirectlyViaOpenOcean(
  pc: PublicClient,
  writeContractAsync: (args: any) => Promise<any>,
  sendTransactionAsync: (args: any) => Promise<any>,
  account: Address,
  inToken: TokenMeta,
  outToken: TokenMeta,
  amountIn: bigint,
  slippageBps: number,
  onStatusChange?: (status: "checking" | "approving" | "confirming" | "complete") => void,
): Promise<{ txHash: string }> {
  console.log('🚀 executeSwapDirectlyViaOpenOcean (no fee):', {
    inToken: inToken.address,
    outToken: outToken.address,
    amountIn: amountIn.toString(),
  });

  // Get swap calldata from OpenOcean with user as the caller
  const swapData = await fetchOpenOceanSwapBase({
    inTokenAddress: inToken.address,
    outTokenAddress: outToken.address,
    amountWei: amountIn, // Full amount, no fee deduction
    slippageBps,
    account, // User address - user calls OpenOcean directly
    gasPriceWei: await pc.getGasPrice(),
  });

  const isNative = inToken.address === NATIVE_SENTINEL;
  const inAddrForContract = isNative ? (ZERO_ADDRESS as Address) : (inToken.address as Address);

  // For ERC20, we need to check current allowance and read what OpenOcean's contract will actually pull
  // The safest approach is to approve a slightly higher amount than our input to handle routing variance
  // Most aggregators use max approval or a buffer to handle this
  if (!isNative) {
    // Read current allowance first
    let currentAllowance = 0n;
    try {
      currentAllowance = (await pc.readContract({
        address: inAddrForContract,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [account, swapData.to],
      })) as bigint;
    } catch (e) {
      console.warn("Could not read current allowance:", e);
    }

    console.log('📊 OpenOcean approval check:', {
      ourAmount: amountIn.toString(),
      openOceanInAmount: swapData.inAmountWei?.toString(),
      currentAllowance: currentAllowance.toString(),
      spender: swapData.to,
    });

    // If current allowance is less than 2x our amount, approve max uint256
    // This is standard practice for aggregators - prevents repeated approval transactions
    // OpenOcean's routing may pull varying amounts depending on the path taken
    const minRequired = amountIn * 2n;
    if (currentAllowance < minRequired) {
      // Use max uint256 approval (infinite approval) - standard for aggregators
      const MAX_UINT256 = 2n ** 256n - 1n;

      onStatusChange?.("approving");

      // Some tokens (USDT, KTA, etc.) don't allow changing allowance from non-zero to non-zero
      // This is a security feature to prevent front-running attacks
      // Solution: Reset to 0 first, then set to max
      if (currentAllowance > 0n) {
        console.log(`📝 Resetting allowance to 0 first (current: ${currentAllowance.toString()})`);
        const resetHash = await writeContractAsync({
          address: inAddrForContract,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [swapData.to, 0n],
        });
        console.log(`⏳ Waiting for reset transaction: ${resetHash}`);
        await pc.waitForTransactionReceipt({ hash: resetHash as `0x${string}` });
        console.log("✅ Allowance reset to 0");
      }

      console.log(`📝 Requesting max approval for OpenOcean router (infinite approval)`);
      const hash = await writeContractAsync({
        address: inAddrForContract,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [swapData.to, MAX_UINT256],
      });

      console.log(`⏳ Waiting for approval transaction: ${hash}`);
      onStatusChange?.("confirming");
      await pc.waitForTransactionReceipt({ hash: hash as `0x${string}` });
      console.log("✅ Approval confirmed");
      onStatusChange?.("complete");
    } else {
      console.log("✅ Sufficient allowance already exists");
      onStatusChange?.("complete");
    }
  }

  console.log('✅ Calling OpenOcean router directly (no intermediary)');

  // Call OpenOcean directly using sendTransaction for raw calldata
  const hash = await sendTransactionAsync({
    to: swapData.to,
    data: swapData.data,
    value: isNative ? amountIn : 0n,
    chainId: base.id,
  });

  return { txHash: hash as string };
}
