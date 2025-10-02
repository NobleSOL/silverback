// functions/token.js
import { withCors } from "./cors.js";
import {
  createClient,
  loadTokenDetails,
} from "./utils/keeta.js";

function bigintReplacer(_k, v) {
  return typeof v === "bigint" ? v.toString() : v;
}

export const handler = withCors(async (event) => {
  if (event.httpMethod?.toUpperCase() === "OPTIONS") {
    return { statusCode: 204, body: "" };
  }
  if (event.httpMethod?.toUpperCase() !== "GET") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  const qsAddr = event.queryStringParameters?.address;
  const pathParts = (event.path || "").split("/").filter(Boolean);
  const tail = pathParts[pathParts.length - 1];
  const address = qsAddr || (tail?.toLowerCase() !== "token" ? tail : null);

  if (!address) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing token address" }) };
  }

  try {
    const client = await createClient({});
    const account = client.lib.Account.toAccount(address);
    const details = await loadTokenDetails(client, account);

    const response = {
      address,
      symbol: details.symbol,
      decimals: details.decimals,
      metadata: details.metadata,
      source: "chain",
    };
    return { statusCode: 200, body: JSON.stringify(response, bigintReplacer) };
  } catch (err) {
    console.error("token metadata error", err);

    const fallbackDecimals = Number(process.env.TOKEN_B_DECIMALS || 9);
    return {
      statusCode: 200,
      body: JSON.stringify({
        address,
        symbol: "TOKENB",
        decimals: fallbackDecimals,
        source: "fallback",
      }),
    };
  }
});
