// src/utils/transactionHistory.js
import fs from 'fs/promises';
import path from 'path';

/**
 * Manages transaction history for the DEX
 */
export class TransactionHistory {
  constructor() {
    this.transactions = [];
    this.persistencePath = '.transactions.json';
    this.maxTransactions = 1000; // Keep last 1000 transactions
  }

  /**
   * Initialize and load existing transactions
   */
  async initialize() {
    await this.loadTransactions();
    console.log(`✅ TransactionHistory initialized with ${this.transactions.length} transactions`);
    return this;
  }

  /**
   * Load transactions from persistent storage
   */
  async loadTransactions() {
    try {
      const data = await fs.readFile(this.persistencePath, 'utf8');
      this.transactions = JSON.parse(data);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn('⚠️ Could not load transactions:', err.message);
      }
      this.transactions = [];
    }
  }

  /**
   * Save transactions to persistent storage
   */
  async saveTransactions() {
    try {
      await fs.writeFile(
        this.persistencePath,
        JSON.stringify(this.transactions, null, 2)
      );
    } catch (err) {
      console.error('❌ Failed to save transactions:', err.message);
    }
  }

  /**
   * Log a swap transaction
   */
  async logSwap({
    userAddress,
    poolAddress,
    tokenIn,
    tokenOut,
    amountIn,
    amountOut,
    feeAmount,
    priceImpact,
  }) {
    const transaction = {
      type: 'SWAP_FORWARD',
      timestamp: Date.now(),
      user: userAddress,
      pool: poolAddress,
      tokenIn,
      tokenOut,
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      feeAmount: feeAmount.toString(),
      priceImpact: priceImpact.toString(),
    };

    this.transactions.unshift(transaction); // Add to beginning

    // Trim to max size
    if (this.transactions.length > this.maxTransactions) {
      this.transactions = this.transactions.slice(0, this.maxTransactions);
    }

    await this.saveTransactions();
    return transaction;
  }

  /**
   * Log a liquidity addition
   */
  async logAddLiquidity({
    userAddress,
    poolAddress,
    tokenA,
    tokenB,
    amountA,
    amountB,
    liquidity,
  }) {
    const transaction = {
      type: 'ADD_LIQUIDITY',
      timestamp: Date.now(),
      user: userAddress,
      pool: poolAddress,
      tokenA,
      tokenB,
      amountA: amountA.toString(),
      amountB: amountB.toString(),
      liquidity: liquidity.toString(),
    };

    this.transactions.unshift(transaction);

    if (this.transactions.length > this.maxTransactions) {
      this.transactions = this.transactions.slice(0, this.maxTransactions);
    }

    await this.saveTransactions();
    return transaction;
  }

  /**
   * Log a liquidity removal
   */
  async logRemoveLiquidity({
    userAddress,
    poolAddress,
    tokenA,
    tokenB,
    amountA,
    amountB,
    liquidity,
  }) {
    const transaction = {
      type: 'REMOVE_LIQUIDITY',
      timestamp: Date.now(),
      user: userAddress,
      pool: poolAddress,
      tokenA,
      tokenB,
      amountA: amountA.toString(),
      amountB: amountB.toString(),
      liquidity: liquidity.toString(),
    };

    this.transactions.unshift(transaction);

    if (this.transactions.length > this.maxTransactions) {
      this.transactions = this.transactions.slice(0, this.maxTransactions);
    }

    await this.saveTransactions();
    return transaction;
  }

  /**
   * Get recent transactions
   */
  getTransactions(limit = 50, filter = {}) {
    let filtered = this.transactions;

    // Filter by type
    if (filter.type) {
      filtered = filtered.filter((tx) => tx.type === filter.type);
    }

    // Filter by user
    if (filter.user) {
      filtered = filtered.filter((tx) => tx.user === filter.user);
    }

    // Filter by pool
    if (filter.pool) {
      filtered = filtered.filter((tx) => tx.pool === filter.pool);
    }

    return filtered.slice(0, limit);
  }

  /**
   * Format transaction for display (like "4 hours ago SWAP_FORWARD...")
   */
  formatTransaction(tx) {
    const timeAgo = this.formatTimeAgo(tx.timestamp);
    const fromAddr = this.abbreviateAddress(tx.user);

    if (tx.type === 'SWAP_FORWARD') {
      const toAddr = this.abbreviateAddress(tx.pool);
      const amountIn = Number(tx.amountIn) / 1e9;
      const priceImpact = Number(tx.priceImpact).toFixed(1);
      const tokenSymbol = this.getTokenSymbol(tx.tokenIn);

      return `${timeAgo} SWAP_FORWARD ${fromAddr} ${toAddr} ${amountIn} ${tokenSymbol} ${priceImpact}%`;
    } else if (tx.type === 'ADD_LIQUIDITY') {
      const poolAddr = this.abbreviateAddress(tx.pool);
      const amountA = Number(tx.amountA) / 1e9;
      const amountB = Number(tx.amountB) / 1e9;
      const lpTokens = Number(tx.liquidity) / 1e9;

      return `${timeAgo} ADD_LIQUIDITY ${fromAddr} ${poolAddr} ${amountA}+${amountB} LP:${lpTokens.toFixed(2)}`;
    } else if (tx.type === 'REMOVE_LIQUIDITY') {
      const poolAddr = this.abbreviateAddress(tx.pool);
      const amountA = Number(tx.amountA) / 1e9;
      const amountB = Number(tx.amountB) / 1e9;
      const lpTokens = Number(tx.liquidity) / 1e9;

      return `${timeAgo} REMOVE_LIQUIDITY ${fromAddr} ${poolAddr} ${amountA}+${amountB} LP:${lpTokens.toFixed(2)}`;
    }

    return `${timeAgo} ${tx.type} ${fromAddr}`;
  }

  /**
   * Format timestamp as "X hours/minutes/seconds ago"
   */
  formatTimeAgo(timestamp) {
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
   * Abbreviate Keeta address (keet...lvsi style)
   */
  abbreviateAddress(address) {
    if (!address || address.length < 15) return address;

    // Extract the part after "keeta_"
    const withoutPrefix = address.replace('keeta_', '');

    // Take first 4 and last 4 characters
    const start = withoutPrefix.substring(0, 4);
    const end = withoutPrefix.substring(withoutPrefix.length - 4);

    return `keet...${end}`;
  }

  /**
   * Get token symbol from address (simple mapping)
   */
  getTokenSymbol(tokenAddress) {
    // Simple symbol extraction - you can enhance this
    const symbols = {
      'keeta_anyiff4v34alvumupagmdyosydeq24lc4def5mrpmmyhx3j6vj2uucckeqn52': 'KTA',
      'keeta_anchh4m5ukgvnx5jcwe56k3ltgo4x4kppicdjgcaftx4525gdvknf73fotmdo': 'RIDE',
    };

    return symbols[tokenAddress] || 'TOKEN';
  }
}

// Singleton instance
let historyInstance = null;

/**
 * Get the singleton TransactionHistory instance
 */
export async function getTransactionHistory() {
  if (!historyInstance) {
    historyInstance = new TransactionHistory();
    await historyInstance.initialize();
  }
  return historyInstance;
}
