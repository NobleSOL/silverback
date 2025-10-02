// client/src/api.js

const API_BASE = process.env.REACT_APP_API_BASE || "";

export async function fetchTokenMetadata(address) {
  const res = await fetch(`${API_BASE}/token?address=${address}`);
  if (!res.ok) throw new Error("Failed to fetch token metadata");
  return res.json();
}

export async function executeSwap({ seed, tokenIn, tokenOut, amountIn }) {
  const res = await fetch(`${API_BASE}/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seed, tokenIn, tokenOut, amountIn }),
  });
  if (!res.ok) throw new Error("Swap failed");
  return res.json();
}
