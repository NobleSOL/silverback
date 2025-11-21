// src/routes/transactions.js
import express from 'express';
import fs from 'fs/promises';

const router = express.Router();

/**
 * Get transaction history in explorer format
 */
router.get('/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const historyPath = '.transactions.json';

    let transactions = [];
    try {
      const data = await fs.readFile(historyPath, 'utf8');
      transactions = JSON.parse(data);
    } catch (err) {
      // No transactions yet
    }

    // Format transactions in explorer style
    const formatted = transactions.slice(0, limit).map(tx => {
      return formatTransaction(tx);
    });

    res.json({
      success: true,
      count: formatted.length,
      transactions: formatted,
    });
  } catch (err) {
    console.error('Transaction history error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * Get raw transaction data
 */
router.get('/raw', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const historyPath = '.transactions.json';

    let transactions = [];
    try {
      const data = await fs.readFile(historyPath, 'utf8');
      transactions = JSON.parse(data);
    } catch (err) {
      // No transactions yet
    }

    res.json({
      success: true,
      count: transactions.length,
      transactions: transactions.slice(0, limit),
    });
  } catch (err) {
    console.error('Transaction history error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * Format transaction in explorer style
 */
function formatTransaction(tx) {
  const timeAgo = formatTimeAgo(tx.timestamp);
  const fromAddr = abbreviateAddress(tx.user);
  const toAddr = abbreviateAddress(tx.pool);
  const amount = (Number(tx.amountIn) / 1e9).toFixed(9);
  const token = getTokenSymbol(tx.tokenIn);
  const impact = Number(tx.priceImpact).toFixed(1);

  return {
    formatted: `${timeAgo} SWAP_FORWARD ${fromAddr} ${toAddr} ${amount} ${token} ${impact}%`,
    timestamp: tx.timestamp,
    type: tx.type,
    user: tx.user,
    pool: tx.pool,
    amountIn: tx.amountIn,
    amountOut: tx.amountOut,
    priceImpact: tx.priceImpact,
  };
}

/**
 * Format time ago
 */
function formatTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Abbreviate address
 */
function abbreviateAddress(address) {
  if (!address || address.length < 15) return address;
  const withoutPrefix = address.replace('keeta_', '');
  const end = withoutPrefix.substring(withoutPrefix.length - 4);
  return `keet...${end}`;
}

/**
 * Get token symbol
 */
function getTokenSymbol(tokenAddress) {
  const symbols = {
    'keeta_anyiff4v34alvumupagmdyosydeq24lc4def5mrpmmyhx3j6vj2uucckeqn52': 'KTA',
    'keeta_anchh4m5ukgvnx5jcwe56k3ltgo4x4kppicdjgcaftx4525gdvknf73fotmdo': 'RIDE',
  };
  return symbols[tokenAddress] || 'TOKEN';
}

export default router;
