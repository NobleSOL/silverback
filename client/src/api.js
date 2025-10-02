// client/src/api.js

export async function fetchTokenByAddress(address) {
  const res = await fetch(`/.netlify/functions/token?address=${encodeURIComponent(address)}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  const payload = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(payload.error || "Failed to resolve token");
  }

  // Expected shape from token.js:
  // { address, symbol, decimals, metadata, source }
  return payload;
}
