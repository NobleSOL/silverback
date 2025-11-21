// Keythings Wallet Provider Integration
// For use with the Keeta blockchain via window.keeta

export interface KeetaProvider {
  // Identity
  isKeeta: boolean;
  isAvailable: boolean;

  // Connection state
  isConnected: boolean;
  isLocked: boolean;
  selectedAddress: string | null;

  // Network info
  network: string;
  chainId: string;

  // Core methods
  requestAccounts: () => Promise<string[]>;
  getAccounts: () => Promise<string[]>;

  // Balance methods
  getBalance: (address: string) => Promise<string>;
  getAllBalances: (address: string) => Promise<Record<string, string>>;
  getNormalizedBalances: (address: string) => Promise<Array<{ token: string; balance: string }>>;

  // Account methods
  getAccountState: (address: string) => Promise<any>;
  getAccountInfo: (address: string) => Promise<any>;
  getBaseToken: () => Promise<string>;

  // Network methods
  getNetwork: () => Promise<string>;
  switchNetwork: (network: string) => Promise<void>;

  // Transaction methods
  signMessage: (message: string) => Promise<string>;

  // Capability system
  requestCapabilities: (capabilities: string[]) => Promise<any>;
  refreshCapabilities: () => Promise<void>;

  // Client management
  getUserClient: () => Promise<any>;
  createUserClient: (params: any) => Promise<any>;

  // Storage
  listStorageAccountsByOwner: (owner: string) => Promise<any[]>;

  // Price info
  getKtaPrice: () => Promise<number>;

  // History
  history: any;

  // Generic request/send (for advanced usage)
  request: (args: { method: string; params?: any[] }) => Promise<any>;
  send: (method: string, params?: any[]) => Promise<any>;

  // Event listeners
  on: (event: string, handler: (...args: any[]) => void) => void;
  removeListener: (event: string, handler: (...args: any[]) => void) => void;
  removeAllListeners: (event?: string) => void;
}

declare global {
  interface Window {
    keeta?: KeetaProvider;
  }
}

/**
 * Check if Keythings wallet is installed
 */
export function isKeythingsInstalled(): boolean {
  // Check if window.keeta exists and has the requestAccounts method
  // This is more reliable than checking isKeeta flag which might not be set
  return typeof window !== 'undefined' &&
         typeof window.keeta !== 'undefined' &&
         typeof window.keeta.requestAccounts === 'function';
}

/**
 * Get the Keythings provider instance
 */
export function getKeythingsProvider(): KeetaProvider | null {
  if (isKeythingsInstalled()) {
    return window.keeta!;
  }
  return null;
}

/**
 * Request connection to Keythings wallet
 * This will prompt the user to approve the connection
 */
export async function connectKeythings(): Promise<string[]> {
  const provider = getKeythingsProvider();
  if (!provider) {
    throw new Error('Keythings wallet is not installed');
  }

  try {
    // Use native requestAccounts method
    const accounts = await provider.requestAccounts();
    return accounts;
  } catch (error: any) {
    console.error('Failed to connect to Keythings:', error);
    throw new Error(`Connection failed: ${error.message}`);
  }
}

/**
 * Get currently connected accounts
 */
export async function getAccounts(): Promise<string[]> {
  const provider = getKeythingsProvider();
  if (!provider) {
    throw new Error('Keythings wallet is not installed');
  }

  try {
    // Use native getAccounts method
    const accounts = await provider.getAccounts();
    return accounts;
  } catch (error: any) {
    console.error('Failed to get accounts:', error);
    throw new Error(`Failed to get accounts: ${error.message}`);
  }
}

/**
 * Get the currently selected address (synchronous)
 */
export function getSelectedAddress(): string | null {
  const provider = getKeythingsProvider();
  return provider?.selectedAddress || null;
}

/**
 * Check if wallet is connected
 */
export function isConnected(): boolean {
  const provider = getKeythingsProvider();
  return provider?.isConnected || false;
}

/**
 * Check if wallet is locked
 */
export function isLocked(): boolean {
  const provider = getKeythingsProvider();
  return provider?.isLocked || false;
}

/**
 * Request the wallet to switch to a specific network
 * @param network - 'mainnet' or 'testnet'
 */
export async function switchNetwork(network: 'mainnet' | 'testnet'): Promise<void> {
  const provider = getKeythingsProvider();
  if (!provider) {
    throw new Error('Keythings wallet is not installed');
  }

  try {
    // Use native switchNetwork method
    await provider.switchNetwork(network);
  } catch (error: any) {
    console.error('Failed to switch network:', error);
    throw new Error(`Network switch failed: ${error.message}`);
  }
}

/**
 * Get current network
 */
export async function getNetwork(): Promise<string> {
  const provider = getKeythingsProvider();
  if (!provider) {
    throw new Error('Keythings wallet is not installed');
  }

  try {
    return await provider.getNetwork();
  } catch (error: any) {
    console.error('Failed to get network:', error);
    throw new Error(`Failed to get network: ${error.message}`);
  }
}

/**
 * Get account balance for a specific token
 * @param address - Account address
 */
export async function getBalance(address: string): Promise<string> {
  const provider = getKeythingsProvider();
  if (!provider) {
    throw new Error('Keythings wallet is not installed');
  }

  try {
    return await provider.getBalance(address);
  } catch (error: any) {
    console.error('Failed to get balance:', error);
    throw new Error(`Failed to get balance: ${error.message}`);
  }
}

/**
 * Get all token balances for an account
 * @param address - Account address
 */
export async function getAllBalances(address: string): Promise<Record<string, string>> {
  const provider = getKeythingsProvider();
  if (!provider) {
    throw new Error('Keythings wallet is not installed');
  }

  try {
    return await provider.getAllBalances(address);
  } catch (error: any) {
    console.error('Failed to get all balances:', error);
    throw new Error(`Failed to get all balances: ${error.message}`);
  }
}

/**
 * Get normalized balances (array format)
 * @param address - Account address
 */
export async function getNormalizedBalances(address: string): Promise<Array<{ token: string; balance: string }>> {
  const provider = getKeythingsProvider();
  if (!provider) {
    throw new Error('Keythings wallet is not installed');
  }

  try {
    return await provider.getNormalizedBalances(address);
  } catch (error: any) {
    console.error('Failed to get normalized balances:', error);
    throw new Error(`Failed to get normalized balances: ${error.message}`);
  }
}

/**
 * Get account state
 * @param address - Account address
 */
export async function getAccountState(address: string): Promise<any> {
  const provider = getKeythingsProvider();
  if (!provider) {
    throw new Error('Keythings wallet is not installed');
  }

  try {
    return await provider.getAccountState(address);
  } catch (error: any) {
    console.error('Failed to get account state:', error);
    throw new Error(`Failed to get account state: ${error.message}`);
  }
}

/**
 * Sign a message with the connected account
 * @param message - Message to sign
 */
export async function signMessage(message: string): Promise<string> {
  const provider = getKeythingsProvider();
  if (!provider) {
    throw new Error('Keythings wallet is not installed');
  }

  try {
    // Use native signMessage method
    const signature = await provider.signMessage(message);
    return signature;
  } catch (error: any) {
    console.error('Signing failed:', error);
    throw new Error(`Signing failed: ${error.message}`);
  }
}

/**
 * Request capabilities from the wallet
 * @param capabilities - Array of capability names
 */
export async function requestCapabilities(capabilities: string[]): Promise<any> {
  const provider = getKeythingsProvider();
  if (!provider) {
    throw new Error('Keythings wallet is not installed');
  }

  try {
    return await provider.requestCapabilities(capabilities);
  } catch (error: any) {
    console.error('Failed to request capabilities:', error);
    throw new Error(`Failed to request capabilities: ${error.message}`);
  }
}

/**
 * Get KTA price
 */
export async function getKtaPrice(): Promise<number> {
  const provider = getKeythingsProvider();
  if (!provider) {
    throw new Error('Keythings wallet is not installed');
  }

  try {
    return await provider.getKtaPrice();
  } catch (error: any) {
    console.error('Failed to get KTA price:', error);
    throw new Error(`Failed to get KTA price: ${error.message}`);
  }
}

/**
 * Listen for account changes
 */
export function onAccountsChanged(handler: (accounts: string[]) => void): void {
  const provider = getKeythingsProvider();
  if (provider) {
    provider.on('accountsChanged', handler);
  }
}

/**
 * Listen for network/chain changes
 */
export function onChainChanged(handler: (chainId: string) => void): void {
  const provider = getKeythingsProvider();
  if (provider) {
    provider.on('chainChanged', handler);
  }
}

/**
 * Listen for connection state changes
 */
export function onConnect(handler: (connectInfo: { chainId: string }) => void): void {
  const provider = getKeythingsProvider();
  if (provider) {
    provider.on('connect', handler);
  }
}

/**
 * Listen for disconnection
 */
export function onDisconnect(handler: () => void): void {
  const provider = getKeythingsProvider();
  if (provider) {
    provider.on('disconnect', handler);
  }
}

/**
 * Remove account change listener
 */
export function removeAccountsChangedListener(handler: (accounts: string[]) => void): void {
  const provider = getKeythingsProvider();
  if (provider) {
    provider.removeListener('accountsChanged', handler);
  }
}

/**
 * Remove chain change listener
 */
export function removeChainChangedListener(handler: (chainId: string) => void): void {
  const provider = getKeythingsProvider();
  if (provider) {
    provider.removeListener('chainChanged', handler);
  }
}

/**
 * Remove all listeners for a specific event
 */
export function removeAllListeners(event?: string): void {
  const provider = getKeythingsProvider();
  if (provider) {
    provider.removeAllListeners(event);
  }
}
