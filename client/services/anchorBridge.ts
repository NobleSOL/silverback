// Anchor Bridge Service for Base to Keeta transfers
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseUnits,
  formatUnits,
  type Address,
  type Hash,
} from 'viem';
import { base } from 'viem/chains';
import { ANCHOR_CONFIG, CHAIN_CONFIG, type SupportedToken } from '@/config/chains';

// ERC20 ABI for token approvals and balance checks
const ERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

// Base Anchor Contract ABI (simplified - update with actual ABI when available)
const ANCHOR_ABI = [
  {
    type: 'function',
    name: 'lock',
    stateMutability: 'payable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'keetaRecipient', type: 'string' },
    ],
    outputs: [{ name: 'lockId', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'getLockStatus',
    stateMutability: 'view',
    inputs: [{ name: 'lockId', type: 'bytes32' }],
    outputs: [{
      name: 'status',
      type: 'tuple',
      components: [
        { name: 'completed', type: 'bool' },
        { name: 'timestamp', type: 'uint256' },
        { name: 'amount', type: 'uint256' },
      ],
    }],
  },
  {
    type: 'event',
    name: 'TokensLocked',
    inputs: [
      { name: 'lockId', indexed: true, type: 'bytes32' },
      { name: 'token', indexed: true, type: 'address' },
      { name: 'amount', indexed: false, type: 'uint256' },
      { name: 'keetaRecipient', indexed: false, type: 'string' },
    ],
  },
] as const;

export interface BridgeQuote {
  amountIn: string;
  amountOut: string;
  anchorFee: string;
  silverbackFee: string;
  totalFee: string;
  estimatedTime: number;
}

export interface BridgeStatus {
  lockTxHash?: Hash;
  lockId?: string;
  keetaTxHash?: string;
  status: 'pending' | 'locking' | 'locked' | 'minting' | 'completed' | 'failed';
  error?: string;
}

// Create public client for Base chain
const publicClient = createPublicClient({
  chain: base,
  transport: http(import.meta.env.VITE_BASE_RPC_URL || base.rpcUrls.default.http[0]),
});

/**
 * Get a quote for bridging tokens from Base to Keeta
 */
export async function getQuote(
  token: SupportedToken,
  amount: string
): Promise<BridgeQuote> {
  const tokenConfig = ANCHOR_CONFIG.supportedTokens[token];
  const amountBigInt = parseUnits(amount, tokenConfig.decimals);

  // Calculate fees
  const anchorFeeBigInt = (amountBigInt * BigInt(Math.floor(ANCHOR_CONFIG.fees.anchorBaseFee * 10000))) / 10000n;
  const silverbackFeeBigInt = (amountBigInt * BigInt(Math.floor(ANCHOR_CONFIG.fees.silverbackFee * 10000))) / 10000n;
  const totalFeeBigInt = anchorFeeBigInt + silverbackFeeBigInt;
  const amountOutBigInt = amountBigInt - totalFeeBigInt;

  return {
    amountIn: amount,
    amountOut: formatUnits(amountOutBigInt, tokenConfig.decimals),
    anchorFee: formatUnits(anchorFeeBigInt, tokenConfig.decimals),
    silverbackFee: formatUnits(silverbackFeeBigInt, tokenConfig.decimals),
    totalFee: formatUnits(totalFeeBigInt, tokenConfig.decimals),
    estimatedTime: ANCHOR_CONFIG.estimatedBridgeTime,
  };
}

/**
 * Get Base token balance for connected wallet
 */
export async function getBaseBalance(
  token: SupportedToken,
  userAddress: Address
): Promise<string> {
  const tokenConfig = ANCHOR_CONFIG.supportedTokens[token];

  const balance = await publicClient.readContract({
    address: tokenConfig.baseAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [userAddress],
  });

  return formatUnits(balance, tokenConfig.decimals);
}

/**
 * Check if token approval is needed
 */
export async function checkApproval(
  token: SupportedToken,
  userAddress: Address,
  amount: string
): Promise<boolean> {
  const tokenConfig = ANCHOR_CONFIG.supportedTokens[token];
  const amountBigInt = parseUnits(amount, tokenConfig.decimals);

  const allowance = await publicClient.readContract({
    address: tokenConfig.baseAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [userAddress, ANCHOR_CONFIG.baseAnchorAddress],
  });

  return allowance >= amountBigInt;
}

/**
 * Approve token for bridge contract
 */
export async function approveToken(
  token: SupportedToken,
  amount: string,
  walletClient: any
): Promise<Hash> {
  const tokenConfig = ANCHOR_CONFIG.supportedTokens[token];
  const amountBigInt = parseUnits(amount, tokenConfig.decimals);

  const hash = await walletClient.writeContract({
    address: tokenConfig.baseAddress,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [ANCHOR_CONFIG.baseAnchorAddress, amountBigInt],
  });

  // Wait for confirmation
  await publicClient.waitForTransactionReceipt({ hash });

  return hash;
}

/**
 * Bridge tokens from Base to Keeta
 */
export async function bridgeToKeeta(
  token: SupportedToken,
  amount: string,
  keetaAddress: string,
  walletClient: any,
  onStatusChange?: (status: BridgeStatus) => void
): Promise<BridgeStatus> {
  const status: BridgeStatus = { status: 'pending' };

  try {
    const tokenConfig = ANCHOR_CONFIG.supportedTokens[token];
    const amountBigInt = parseUnits(amount, tokenConfig.decimals);

    // Step 1: Lock tokens on Base
    status.status = 'locking';
    onStatusChange?.(status);

    const lockHash = await walletClient.writeContract({
      address: ANCHOR_CONFIG.baseAnchorAddress,
      abi: ANCHOR_ABI,
      functionName: 'lock',
      args: [tokenConfig.baseAddress, amountBigInt, keetaAddress],
    });

    status.lockTxHash = lockHash;
    status.status = 'locked';
    onStatusChange?.(status);

    // Wait for lock confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash: lockHash });

    // Extract lockId from event logs
    const lockEvent = receipt.logs.find((log: any) =>
      log.topics[0] === '0x...' // TODO: Update with actual TokensLocked event signature
    );

    if (lockEvent) {
      status.lockId = lockEvent.topics[1];
    }

    // Step 2: Monitor Keeta for mint completion
    status.status = 'minting';
    onStatusChange?.(status);

    const keetaTxHash = await waitForKeetaMint(keetaAddress, amount, tokenConfig.keetaAddress);

    status.keetaTxHash = keetaTxHash;
    status.status = 'completed';
    onStatusChange?.(status);

    return status;
  } catch (error: any) {
    status.status = 'failed';
    status.error = error.message;
    onStatusChange?.(status);
    throw error;
  }
}

/**
 * Wait for tokens to be minted on Keeta
 */
export async function waitForKeetaMint(
  keetaAddress: string,
  expectedAmount: string,
  tokenAddress: string,
  maxAttempts: number = 60 // 3 minutes with 3s intervals
): Promise<string> {
  // Query Keeta API to check for new token balance
  const checkBalance = async (): Promise<{ balance: string; txHash?: string }> => {
    const response = await fetch(`${CHAIN_CONFIG.keeta.rpcUrl}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getBalance',
        params: {
          address: keetaAddress,
          token: tokenAddress,
        },
      }),
    });

    const data = await response.json();
    return {
      balance: data.result?.balance || '0',
      txHash: data.result?.lastTxHash,
    };
  };

  let attempts = 0;
  while (attempts < maxAttempts) {
    const { balance, txHash } = await checkBalance();

    // Check if balance increased (simplified - may need better logic)
    if (parseFloat(balance) > 0 && txHash) {
      return txHash;
    }

    await new Promise(resolve => setTimeout(resolve, 3000));
    attempts++;
  }

  throw new Error('Keeta mint timeout - please check Keeta explorer manually');
}

/**
 * Get bridge status by lock ID
 */
export async function getBridgeStatus(lockId: string): Promise<BridgeStatus> {
  try {
    const lockStatus = await publicClient.readContract({
      address: ANCHOR_CONFIG.baseAnchorAddress,
      abi: ANCHOR_ABI,
      functionName: 'getLockStatus',
      args: [lockId as `0x${string}`],
    });

    return {
      status: lockStatus.completed ? 'completed' : 'locked',
    };
  } catch (error: any) {
    return {
      status: 'failed',
      error: error.message,
    };
  }
}
