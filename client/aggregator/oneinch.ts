import { parseUnits, formatUnits } from "viem";

// 1inch v6 API - Base mainnet (chain ID 8453)
const ONEINCH_API_BASE = "https://api.1inch.dev/swap/v6.0/8453";
const CHAIN_ID = 8453; // Base mainnet

export type QuoteParams = {
  inTokenAddress: `0x${string}` | "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  outTokenAddress: `0x${string}` | "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  amountWei: bigint;
};

export type QuoteResult = {
  outAmountWei: bigint;
  dataRaw: any;
};

export type SwapBuildParams = {
  inTokenAddress: `0x${string}` | "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  outTokenAddress: `0x${string}` | "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  amountWei: bigint;
  slippageBps: number; // e.g. 50 -> 0.50%
  account: `0x${string}`;
};

export type SwapBuildResult = {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
  outAmountWei?: bigint;
  raw: any;
};

function getApiKey(): string | null {
  const key = (import.meta as any).env?.VITE_ONEINCH_API_KEY as string | undefined;
  return key || null;
}

function getHeaders(): Record<string, string> {
  const apiKey = getApiKey();
  const headers: Record<string, string> = {
    "accept": "application/json",
  };

  // API key is optional - 1inch has a free tier without auth
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  return headers;
}

export async function fetch1inchQuote({
  inTokenAddress,
  outTokenAddress,
  amountWei,
}: QuoteParams): Promise<QuoteResult> {
  const params = new URLSearchParams({
    src: inTokenAddress,
    dst: outTokenAddress,
    amount: amountWei.toString(),
  });

  const url = `${ONEINCH_API_BASE}/quote?${params.toString()}`;

  console.log('🔵 1inch quote request:', {
    url,
    params: { src: inTokenAddress, dst: outTokenAddress, amount: amountWei.toString() }
  });

  const res = await fetch(url, { headers: getHeaders() });

  if (!res.ok) {
    const text = await res.text();
    console.error('❌ 1inch quote failed:', { status: res.status, body: text });
    throw new Error(`1inch quote failed: ${res.status} ${text}`);
  }

  const json = await res.json();

  console.log('✅ 1inch quote response:', {
    dstAmount: json.dstAmount,
    fullResponse: json
  });

  const toAmount = BigInt(json.dstAmount || json.toAmount || 0);

  return { outAmountWei: toAmount, dataRaw: json };
}

export async function fetch1inchSwap({
  inTokenAddress,
  outTokenAddress,
  amountWei,
  slippageBps,
  account,
}: SwapBuildParams): Promise<SwapBuildResult> {
  // 1inch uses slippage as a percentage (1 = 1%)
  const slippagePercent = slippageBps / 100;

  const params = new URLSearchParams({
    src: inTokenAddress,
    dst: outTokenAddress,
    amount: amountWei.toString(),
    from: account,
    slippage: slippagePercent.toString(),
    disableEstimate: "true", // Skip gas estimation for faster response
    allowPartialFill: "false", // Require full fill
  });

  const url = `${ONEINCH_API_BASE}/swap?${params.toString()}`;

  console.log('🔵 1inch swap request:', {
    url,
    params: Object.fromEntries(params)
  });

  const res = await fetch(url, { headers: getHeaders() });

  if (!res.ok) {
    const text = await res.text();
    console.error('❌ 1inch swap build failed:', { status: res.status, body: text });
    throw new Error(`1inch swap build failed: ${res.status} ${text}`);
  }

  const json = await res.json();

  console.log('✅ 1inch swap response:', json);

  // 1inch v6 response format
  const tx = json.tx;
  if (!tx) {
    console.error('❌ 1inch response missing tx field:', json);
    throw new Error('1inch: Invalid response - missing transaction data');
  }

  const to = tx.to as `0x${string}`;
  const dataHex = tx.data as `0x${string}`;
  const valueRaw = tx.value || "0";
  const dstAmount = BigInt(json.dstAmount || json.toAmount || 0);

  if (!to || !dataHex) {
    console.error('❌ 1inch response missing to/data:', { to, dataHex });
    throw new Error('1inch: No liquidity found or invalid response');
  }

  const value = (() => {
    try {
      return BigInt(valueRaw);
    } catch {
      return 0n;
    }
  })();

  return {
    to,
    data: dataHex,
    value,
    outAmountWei: dstAmount,
    raw: json,
  };
}

export function toWei(amount: string, decimals: number): bigint {
  try {
    return parseUnits(amount || "0", decimals);
  } catch {
    return 0n;
  }
}

export function fromWei(amount: bigint, decimals: number): string {
  return formatUnits(amount, decimals);
}
