// /.netlify/functions/wallet.js
const { lib: KeetaLib, UserClient: KeetaUserClient } = require("@keetanetwork/keetanet-client");

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: "Method not allowed" }),
      };
    }

    const { seed, accountIndex = 0 } = JSON.parse(event.body || "{}");

    if (!seed || typeof seed !== "string") {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing or invalid seed" }),
      };
    }

    const account = KeetaLib.Account.fromSeed(seed, accountIndex);
    const address = account.publicKeyString.get();

    // Try networks in order (testnet first)
    let client;
    let lastError;
    for (const network of ["testnet", "test"]) {
      try {
        client = await KeetaUserClient.fromNetwork(network, account);
        break;
      } catch (err) {
        lastError = err;
      }
    }
    if (!client) throw lastError || new Error("Unable to connect to Keeta network");

    // Get balances
    let accountInfo;
    try {
      accountInfo = await client.client.getAccountInfo(address);
    } catch (err) {
      accountInfo = await client.client.getAccountInfo(account);
    }

    const balances = Array.isArray(accountInfo?.balances) ? accountInfo.balances : [];
    const formattedBalances = balances.map((entry, idx) => {
      const raw = entry?.balance ?? entry?.amount ?? entry?.raw ?? "0";
      return {
        symbol: entry?.symbol || `Token${idx + 1}`,
        balanceRaw: raw.toString(),
        balanceFormatted: formatKeetaBalance(raw),
        accountId: entry?.accountId || address,
      };
    });

    await client.destroy?.();

    return {
      statusCode: 200,
      body: JSON.stringify({
        address,
        identifier: address,
        network: "testnet",
        baseToken: {
          symbol: "KTA",
          balanceRaw: formattedBalances.find((b) => b.symbol === "KTA")?.balanceRaw || "0",
          balanceFormatted: formattedBalances.find((b) => b.symbol === "KTA")?.balanceFormatted || "0",
        },
        balances: formattedBalances,
      }),
    };
  } catch (error) {
    console.error("Wallet function error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || "Internal Server Error" }),
    };
  }
};

// simple balance formatter
function formatKeetaBalance(rawBalance) {
  try {
    const balance = BigInt(rawBalance ?? 0);
    const divisor = 1_000_000_000n;
    const whole = balance / divisor;
    const fraction = (balance % divisor).toString().padStart(9, "0").replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole.toString();
  } catch {
    return "0";
  }
}
