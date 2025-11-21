// src/utils/explorerClient.js
import { getOpsClient } from './client.js';
import { CONFIG } from './constants.js';

/**
 * Fetch and format transactions from Keeta network/explorer
 */
export class ExplorerClient {
  constructor() {
    this.apiUrl = CONFIG.NODE_HTTP.replace('/rpc', '');
  }

  /**
   * Fetch account information from the Keeta SDK client
   * Note: We use the SDK client, not HTTP API, for account queries
   */
  async fetchAccount(accountAddress) {
    try {
      const client = await getOpsClient();
      const { accountFromAddress } = await import('./client.js');

      const account = accountFromAddress(accountAddress);
      const balance = await client.getBalance(account);

      // Get account info using SDK
      // For now, return basic structure - we'll need to query balances per token
      return {
        address: accountAddress,
        balances: {}, // Would need to query each token individually
        createdAccounts: [], // Not easily available from SDK
        accountType: 'ACCOUNT', // Default, would need metadata query
        name: null,
        description: null,
      };
    } catch (err) {
      console.error(`Error fetching account ${accountAddress}:`, err.message);
      return null;
    }
  }

  /**
   * Fetch transactions for an account
   */
  async getAccountTransactions(accountAddress, limit = 50) {
    try {
      const client = await getOpsClient();

      // Fetch account history/transactions
      // Note: This depends on Keeta network API capabilities
      const response = await fetch(`${this.apiUrl}/account/${accountAddress}/transactions?limit=${limit}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch transactions: ${response.statusText}`);
      }

      const data = await response.json();
      return data.transactions || [];
    } catch (err) {
      console.error('Error fetching account transactions:', err.message);
      return [];
    }
  }

  /**
   * Fetch transactions for a pool
   */
  async getPoolTransactions(poolAddress, limit = 50) {
    try {
      const response = await fetch(`${this.apiUrl}/account/${poolAddress}/transactions?limit=${limit}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch transactions: ${response.statusText}`);
      }

      const data = await response.json();
      return this.filterSwapTransactions(data.transactions || []);
    } catch (err) {
      console.error('Error fetching pool transactions:', err.message);
      return [];
    }
  }

  /**
   * Filter transactions to only swaps
   */
  filterSwapTransactions(transactions) {
    return transactions.filter(tx => {
      // Look for send operations that indicate swaps
      return tx.operations && tx.operations.some(op => op.type === 'SEND');
    });
  }

  /**
   * Format transaction in explorer style
   * Example: "4 hours ago SWAP_FORWARD keet...lvsi keet...g5wi 8.128023839 KTA 3.9"
   */
  formatTransaction(tx) {
    const timeAgo = this.formatTimeAgo(tx.timestamp);

    // Extract swap details
    const sendOps = tx.operations.filter(op => op.type === 'SEND');

    if (sendOps.length >= 2) {
      // This looks like a swap (user sends token A, receives token B)
      const fromOp = sendOps[0];
      const toOp = sendOps[1];

      const fromAddr = this.abbreviateAddress(fromOp.from);
      const toAddr = this.abbreviateAddress(fromOp.to);
      const amount = (Number(fromOp.amount) / 1e9).toFixed(9);
      const token = this.getTokenSymbol(fromOp.token);

      // Calculate price impact or fee (if available)
      const priceImpact = tx.priceImpact || this.calculatePriceImpact(sendOps);

      return `${timeAgo} SWAP_FORWARD ${fromAddr} ${toAddr} ${amount} ${token} ${priceImpact.toFixed(1)}`;
    }

    return `${timeAgo} ${tx.type || 'TRANSACTION'} ${this.abbreviateAddress(tx.from)}`;
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

    // Take last 4 characters
    const end = withoutPrefix.substring(withoutPrefix.length - 4);

    return `keet...${end}`;
  }

  /**
   * Get token symbol from address
   */
  getTokenSymbol(tokenAddress) {
    const symbols = {
      'keeta_anyiff4v34alvumupagmdyosydeq24lc4def5mrpmmyhx3j6vj2uucckeqn52': 'KTA',
      'keeta_anchh4m5ukgvnx5jcwe56k3ltgo4x4kppicdjgcaftx4525gdvknf73fotmdo': 'RIDE',
    };

    return symbols[tokenAddress] || 'TOKEN';
  }

  /**
   * Calculate price impact from send operations
   */
  calculatePriceImpact(sendOps) {
    // Simple estimation - actual calculation would need pool state
    // This is a placeholder
    return 3.9;
  }

  /**
   * Fetch recent swaps for a pool (formatted)
   */
  async getFormattedSwaps(poolAddress, limit = 20) {
    const transactions = await this.getPoolTransactions(poolAddress, limit);
    return transactions.map(tx => this.formatTransaction(tx));
  }
}

// Singleton instance
let explorerClientInstance = null;

/**
 * Get the singleton ExplorerClient instance
 */
export function getExplorerClient() {
  if (!explorerClientInstance) {
    explorerClientInstance = new ExplorerClient();
  }
  return explorerClientInstance;
}
