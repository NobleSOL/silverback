// functions/token.js
import { withCors } from "./cors.js";
import { createClient, loadTokenDetails } from "./utils/keeta.js";
import * as KeetaNet from "@keetanetwork/keetanet-client";

export const handler = withCors(async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  const addr = event.queryStringParameters?.address;
  if (!addr) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing token address" }) };
  }

  try {
    const client = await createClient({});
    const account = KeetaNet.lib.Account.toAccount(addr);   // ✅ now KeetaNet is defined
    const details = await loadTokenDetails(client, account);

    return {
      statusCode: 200,
      body: JSON.stringify({
        address: details.address,
        symbol: details.symbol,
        decimals: details.decimals,
        metadata: details.metadata,
        source: "chain",
      }),
    };
  } catch (err) {
    console.error("token metadata error", err);
    const fallbackDecimals = Number(process.env.TOKEN_B_DECIMALS || 9);
    return {
      statusCode: 200,
      body: JSON.stringify({
        address: addr,
        symbol: "TOKEN",
        decimals: fallbackDecimals,
        source: "fallback",
      }),
    };
  }
});
