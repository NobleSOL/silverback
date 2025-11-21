import { parseUnits, formatUnits } from "viem";

export type QuoteParams = {
  inTokenAddress: `0x${string}` | "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  outTokenAddress: `0x${string}` | "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  amountWei: bigint;
  gasPriceWei: bigint;
};

export type QuoteResult = {
  outAmountWei: bigint;
  dataRaw: any;
};

export async function fetchOpenOceanQuoteBase({
  inTokenAddress,
  outTokenAddress,
  amountWei,
  gasPriceWei,
}: QuoteParams): Promise<QuoteResult> {
  const qs = new URLSearchParams({
    inTokenAddress,
    outTokenAddress,
    amountDecimals: amountWei.toString(),
    gasPriceDecimals: gasPriceWei.toString(),
  });
  const url = `https://open-api.openocean.finance/v4/base/quote?${qs.toString()}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenOcean quote failed: ${res.status} ${text}`);
  }
  const json = await res.json();

  // Debug log the raw response
  console.log('OpenOcean quote response:', {
    inToken: inTokenAddress,
    outToken: outTokenAddress,
    rawOutAmount: json?.data?.outAmount || json?.data?.toAmount || json?.toAmount,
    fullData: json?.data
  });

  const toAmount = BigInt(
    json?.data?.outAmount || json?.data?.toAmount || json?.toAmount || 0,
  );

  // OpenOcean returns amounts in their native token precision (wei for most tokens)
  // No conversion needed - return as-is
  return { outAmountWei: toAmount, dataRaw: json };
}

export type SwapBuildParams = {
  inTokenAddress: `0x${string}` | "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  outTokenAddress: `0x${string}` | "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  amountWei: bigint;
  slippageBps: number; // e.g. 50 -> 0.50%
  account: `0x${string}`;
  gasPriceWei: bigint;
};

export type SwapBuildResult = {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
  inAmountWei?: bigint;
  outAmountWei?: bigint;
  raw: any;
};

export async function fetchOpenOceanSwapBase({
  inTokenAddress,
  outTokenAddress,
  amountWei,
  slippageBps,
  account,
  gasPriceWei,
}: SwapBuildParams): Promise<SwapBuildResult> {
  const slippagePct = (slippageBps / 100).toString();
  const qs = new URLSearchParams({
    inTokenAddress,
    outTokenAddress,
    amountDecimals: amountWei.toString(),
    slippage: slippagePct,
    account,
    gasPriceDecimals: gasPriceWei.toString(),
  });
  const url = `https://open-api.openocean.finance/v4/base/swap?${qs.toString()}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenOcean API error (${res.status}): ${text}`);
  }
  const json = await res.json();

  // Debug log to see actual response
  console.log("OpenOcean swap response:", json);

  // Handle error responses from OpenOcean
  if (json.code !== 200 && json.code !== undefined) {
    throw new Error(`OpenOcean: ${json.error || json.message || 'Unknown error'}`);
  }

  const data = json?.data || json;
  const to = (data?.to || data?.tx?.to) as `0x${string}`;
  const dataHex = (data?.data || data?.tx?.data) as `0x${string}`;
  const valueRaw = data?.value ?? data?.tx?.value ?? "0";
  const inAmount = BigInt(
    data?.inAmount || data?.fromAmount || data?.amountIn || 0,
  );
  const outAmount = BigInt(
    data?.outAmount || data?.toAmount || data?.amountOut || 0,
  );

  if (!to || !dataHex) {
    console.error("OpenOcean response missing fields:", {
      to,
      dataHex,
      fullResponse: json
    });
    throw new Error("OpenOcean: No liquidity found or testnet not supported. Try using Silverback V2 pairs.");
  }

  const value = (() => {
    try {
      return BigInt(valueRaw);
    } catch {
      return 0n;
    }
  })();
  return { to, data: dataHex, value, inAmountWei: inAmount, outAmountWei: outAmount, raw: json };
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
