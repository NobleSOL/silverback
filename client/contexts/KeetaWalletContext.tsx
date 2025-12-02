import React, { createContext, useContext, useEffect, useState, useMemo } from "react";
import { toast } from "@/hooks/use-toast";
import { useKeetaTokenPrices } from "@/components/keeta/useKeetaPricing";
import {
  getAddressFromSeed,
  fetchBalances,
  fetchLiquidityPositions,
  fetchPools,
} from "@/lib/keeta-client";
import {
  isKeythingsInstalled,
  connectKeythings,
  isConnected,
  onAccountsChanged,
  onDisconnect,
} from "@/lib/keythings-provider";

// API base URL - uses environment variable if set, otherwise falls back to same origin
// For production: set VITE_KEETA_API_BASE to your Railway backend URL (e.g., https://dexkeeta-production.up.railway.app/api)
// For development: uses Vite dev server on same origin (localhost:8080/api)
const API_BASE = import.meta.env.VITE_KEETA_API_BASE || `${window.location.origin}/api`;

export type KeetaWallet = {
  address: string;
  seed: string;
  accountIndex?: number; // Account derivation index (default 0)
  isKeythings?: boolean; // True if connected via Keythings wallet
  tokens: {
    address: string;
    symbol: string;
    balance: string;
    balanceFormatted: string;
    decimals: number;
  }[];
};

export type KeetaPool = {
  poolAddress: string;
  tokenA: string;
  tokenB: string;
  symbolA: string;
  symbolB: string;
  reserveA: string;
  reserveB: string;
  reserveAHuman: number;
  reserveBHuman: number;
  price: string;
  totalShares: string;
  decimalsA?: number;
  decimalsB?: number;
};

export type KeetaPosition = {
  poolAddress: string;
  lpStorageAddress?: string; // User's LP storage account (optional for backwards compat)
  lpTokenAddress: string; // LP token address (required for Keythings remove liquidity)
  tokenA: string;
  tokenB: string;
  symbolA: string;
  symbolB: string;
  liquidity: string;
  sharePercent: number;
  amountA: string;
  amountB: string;
  timestamp: number;
};

interface KeetaWalletContextValue {
  // State
  wallet: KeetaWallet | null;
  pools: KeetaPool[];
  positions: KeetaPosition[];
  allPools: KeetaPool[];
  loading: boolean;
  keythingsConnected: boolean;
  keythingsAddress: string | null;
  keythingsAvailable: boolean;
  keythingsChecking: boolean;
  showAllTokens: boolean;
  setShowAllTokens: (show: boolean) => void;
  copiedAddress: boolean;

  // Token data
  tokenAddresses: string[];
  tokenPrices: any;
  sortedTokens: any[];
  displayedTokens: any[];

  // Wallet functions
  connectKeythingsWallet: () => Promise<void>;
  disconnectWallet: () => void;
  refreshBalances: () => Promise<void>;
  loadPools: () => Promise<void>;
  fetchPositions: () => Promise<void>;
  copyToClipboard: (text: string) => void;

  // Send dialog state
  sendDialogOpen: boolean;
  setSendDialogOpen: (open: boolean) => void;
  sendToken: { address: string; symbol: string; balanceFormatted: string } | null;
  setSendToken: (token: any) => void;
  sendRecipient: string;
  setSendRecipient: (addr: string) => void;
  sendAmount: string;
  setSendAmount: (amt: string) => void;
  sending: boolean;
  executeSend: () => Promise<void>;
}

const KeetaWalletContext = createContext<KeetaWalletContextValue | undefined>(undefined);

export function KeetaWalletProvider({ children }: { children: React.ReactNode }) {
  const [wallet, setWallet] = useState<KeetaWallet | null>(null);
  const [loading, setLoading] = useState(false);
  const [pools, setPools] = useState<KeetaPool[]>([]);
  const [positions, setPositions] = useState<KeetaPosition[]>([]);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [showAllTokens, setShowAllTokens] = useState(false);

  // Keythings wallet state
  const [keythingsConnected, setKeythingsConnected] = useState(false);
  const [keythingsAddress, setKeythingsAddress] = useState<string | null>(null);
  const [keythingsAvailable, setKeythingsAvailable] = useState(isKeythingsInstalled());
  const [keythingsChecking, setKeythingsChecking] = useState(!isKeythingsInstalled());

  // Send tokens state
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [sendToken, setSendToken] = useState<{ address: string; symbol: string; balanceFormatted: string } | null>(null);
  const [sendRecipient, setSendRecipient] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sending, setSending] = useState(false);

  // Fetch token prices
  const tokenAddresses = wallet?.tokens.map(t => t.address) || [];
  const { data: tokenPrices } = useKeetaTokenPrices(tokenAddresses);

  // Sort and filter tokens - KTA always first, then show top 5 (or all if expanded)
  const sortedTokens = wallet?.tokens.sort((a, b) => {
    if (a.symbol === "KTA") return -1;
    if (b.symbol === "KTA") return 1;
    return 0;
  }) || [];
  const displayedTokens = showAllTokens ? sortedTokens : sortedTokens.slice(0, 5);

  // Load wallet from localStorage on mount
  useEffect(() => {
    const savedWallet = localStorage.getItem("keetaWallet");
    if (savedWallet) {
      try {
        const walletData = JSON.parse(savedWallet);
        setWallet(walletData);

        // If it was a Keythings wallet, update the state
        if (walletData.isKeythings) {
          setKeythingsConnected(true);
          setKeythingsAddress(walletData.address);

          // Set up event listeners for Keythings
          onAccountsChanged((accounts) => {
            console.log('👤 Keythings account changed:', accounts);
            if (accounts.length === 0) {
              disconnectWallet();
            } else {
              connectKeythingsWallet();
            }
          });

          onDisconnect(() => {
            console.log('🔌 Keythings disconnected');
            disconnectWallet();
          });
        }
      } catch (e) {
        console.error("Failed to load wallet:", e);
      }
    }
  }, []);

  // Poll for Keythings extension availability
  useEffect(() => {
    let attempts = 0;
    const maxAttempts = 10; // Poll for up to 5 seconds (10 attempts * 500ms)

    const checkForKeythings = () => {
      const installed = isKeythingsInstalled();

      if (installed) {
        console.log('✅ Keythings extension detected');
        setKeythingsAvailable(true);
        setKeythingsChecking(false);
      } else {
        attempts++;
        if (attempts < maxAttempts) {
          console.log(`🔍 Checking for Keythings extension... attempt ${attempts}/${maxAttempts}`);
          setTimeout(checkForKeythings, 500);
        } else {
          console.log('⚠️ Keythings extension not detected after polling');
          setKeythingsChecking(false);
        }
      }
    };

    // Only start polling if not already installed
    if (!keythingsAvailable) {
      checkForKeythings();
    }
  }, []);

  // Watch for Keythings connection from header
  useEffect(() => {
    // Check if Keythings was connected from the header
    const keythingsConnectedFromHeader = localStorage.getItem('keythingsConnected') === 'true';
    const keythingsAddressFromHeader = localStorage.getItem('keythingsAddress');

    if (keythingsConnectedFromHeader && keythingsAddressFromHeader && !wallet) {
      // Keythings was connected from header but KeetaDex wallet state is not set up
      console.log('🔍 Detected Keythings connection from header, setting up KeetaDex wallet...');
      connectKeythingsWallet();
    }
  }, [wallet]);

  // Watch for disconnection from header (localStorage changes)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      // If keythingsConnected was removed and we're currently connected, disconnect
      if (e.key === 'keythingsConnected' && e.newValue === null && wallet?.isKeythings) {
        console.log('🔍 Detected Keythings disconnection from header (cross-tab), disconnecting DEX card...');
        disconnectWallet();
      }
    };

    // Also poll localStorage every second for same-tab disconnection
    // (storage event only fires across tabs)
    const checkInterval = setInterval(() => {
      const isConnectedInStorage = localStorage.getItem('keythingsConnected') === 'true';
      if (!isConnectedInStorage && wallet?.isKeythings) {
        console.log('🔍 Detected Keythings disconnection from header (same-tab), disconnecting DEX card...');
        disconnectWallet();
      }
    }, 1000);

    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(checkInterval);
    };
  }, [wallet]);

  // Load pools on mount (public, no wallet required)
  useEffect(() => {
    loadPools().catch(err => console.error('Error fetching pools:', err));
  }, []);

  // Fetch user positions when wallet connects
  useEffect(() => {
    if (wallet?.address) {
      fetchPositions().catch(err => console.error('Error fetching positions:', err));
    }
  }, [wallet?.address]);

  // Merge backend pools with pools discovered from user's LP tokens
  const allPools = useMemo(() => {
    const poolMap = new Map<string, KeetaPool>();

    // Blacklist legacy/test pools that should not be displayed
    const BLACKLISTED_POOLS = new Set([
      'keeta_aqkycfpx2rafbdie3kreukjl7cg274kjdo6f6ajk42dp6tpw2z3nug2yd2buk', // Legacy KTA/TEST pool
      'keeta_aty6ahjppurrlzmcxk45kthor7ojea77aeyg6ext5gdvwxh34uue57mtct26a',  // Legacy pool
    ]);

    // Add all backend pools (except blacklisted ones and empty pools)
    pools.forEach(pool => {
      if (BLACKLISTED_POOLS.has(pool.poolAddress)) {
        console.log(`⏭️ Skipping blacklisted pool: ${pool.poolAddress.slice(-8)}`);
        return;
      }

      // Skip pools with no liquidity (0 reserves)
      const reserveAHuman = pool.reserveAHuman ?? 0;
      const reserveBHuman = pool.reserveBHuman ?? 0;

      if (reserveAHuman === 0 && reserveBHuman === 0) {
        console.log(`⏭️ Skipping empty backend pool: ${pool.symbolA}/${pool.symbolB} (${pool.poolAddress.slice(-8)})`);
        return;
      }

      poolMap.set(pool.poolAddress, pool);
    });

    // Add pools discovered from LP tokens (for newly created pools not yet in backend)
    // But skip pools with zero liquidity (burned LP tokens)
    positions.forEach(position => {
      // Skip blacklisted pools even if discovered from LP tokens
      if (BLACKLISTED_POOLS.has(position.poolAddress)) {
        console.log(`⏭️ Skipping blacklisted pool from LP token: ${position.poolAddress.slice(-8)}`);
        return;
      }

      if (!poolMap.has(position.poolAddress)) {
        // Parse amounts to check if position is meaningful
        const userAmountA = parseFloat(position.amountA || '0');
        const userAmountB = parseFloat(position.amountB || '0');
        const sharePercent = position.sharePercent || 0;

        // Skip if:
        // 1. No LP tokens (liquidity = 0)
        // 2. Dust amounts (both amounts < 0.000001)
        // 3. Share percent is effectively zero (< 0.0001%)
        const hasMeaningfulLiquidity =
          BigInt(position.liquidity || 0) > 0n &&
          (userAmountA >= 0.000001 || userAmountB >= 0.000001) &&
          sharePercent >= 0.0001;

        if (hasMeaningfulLiquidity) {
          console.log(`🔍 Discovered pool from LP token: ${position.symbolA}/${position.symbolB}`, {
            amountA: position.amountA,
            amountB: position.amountB,
            sharePercent: position.sharePercent,
          });

          // Calculate total pool reserves from user's position
          // User has sharePercent% of the pool, so total = userAmount / (sharePercent / 100)
          const totalReserveAHuman = sharePercent > 0 ? (userAmountA / sharePercent) * 100 : 0;
          const totalReserveBHuman = sharePercent > 0 ? (userAmountB / sharePercent) * 100 : 0;

          console.log(`📊 Calculated reserves:`, {
            userAmountA,
            userAmountB,
            sharePercent,
            totalReserveAHuman,
            totalReserveBHuman,
          });

          // Convert to atomic units (assuming 9 decimals)
          const reserveA = (totalReserveAHuman * 1e9).toString();
          const reserveB = (totalReserveBHuman * 1e9).toString();

          poolMap.set(position.poolAddress, {
            poolAddress: position.poolAddress,
            tokenA: position.tokenA,
            tokenB: position.tokenB,
            symbolA: position.symbolA,
            symbolB: position.symbolB,
            reserveA,
            reserveB,
            reserveAHuman: totalReserveAHuman,
            reserveBHuman: totalReserveBHuman,
            price: totalReserveBHuman > 0 ? (totalReserveAHuman / totalReserveBHuman).toString() : '0',
            totalShares: position.liquidity,
            decimalsA: 9,
            decimalsB: 9,
          });
        } else {
          console.log(`⏭️ Skipping pool with no meaningful liquidity: ${position.symbolA}/${position.symbolB} (amountA: ${userAmountA}, amountB: ${userAmountB}, share: ${sharePercent}%)`);
        }
      }
    });

    const result = Array.from(poolMap.values());
    console.log('🔄 allPools after merge:', result);
    return result;
  }, [pools, positions]);

  // Auto-refresh balances every 30 seconds while wallet is connected
  useEffect(() => {
    if (!wallet?.address) return;

    // Set up interval to refresh balances
    const intervalId = setInterval(() => {
      console.log('⏰ Auto-refreshing balances...');
      refreshBalances().catch(err => console.error('Auto-refresh failed:', err));
    }, 30000); // 30 seconds

    // Clean up interval on unmount or when wallet disconnects
    return () => clearInterval(intervalId);
  }, [wallet?.address, wallet?.seed, wallet?.accountIndex]);

  async function refreshBalances() {
    if (!wallet) return;

    try {
      console.log('🔄 Refreshing balances...');

      let tokens;

      if (wallet.isKeythings) {
        // Use Keythings API for balance fetching
        console.log('📊 Fetching balances from Keythings...');
        const { getNormalizedBalances, isConnected } = await import('@/lib/keythings-provider');

        // Check if Keythings is still connected
        if (!isConnected()) {
          console.warn('⚠️ Keythings wallet is not connected, skipping balance refresh');
          return;
        }

        const balances = await getNormalizedBalances(wallet.address);

        // Fetch metadata (symbol, decimals) for each token
        const { fetchTokenMetadata } = await import('@/lib/keeta-client');

        tokens = await Promise.all(
          balances.map(async (bal: any) => {
            const metadata = await fetchTokenMetadata(bal.token);
            const balanceValue = BigInt(bal.balance);
            const decimals = metadata.decimals || 9;
            const balanceFormatted = (Number(balanceValue) / Math.pow(10, decimals)).toFixed(decimals);

            return {
              address: bal.token,
              symbol: metadata.symbol,
              balance: bal.balance,
              balanceFormatted,
              decimals,
            };
          })
        );
      } else {
        // Use seed-based balance fetching for regular wallets
        tokens = await fetchBalances(wallet.seed, wallet.accountIndex || 0);
      }

      const updatedWallet = {
        ...wallet,
        tokens,
      };

      setWallet(updatedWallet);
      localStorage.setItem("keetaWallet", JSON.stringify(updatedWallet));
      console.log('✅ Balances refreshed');
    } catch (error: any) {
      console.error('❌ Failed to refresh balances:', error);

      // If Keythings connection is lost, notify user
      if (wallet?.isKeythings && error.message?.includes('not connected')) {
        toast({
          title: "Wallet Connection Lost",
          description: "Please reconnect your Keythings wallet",
          variant: "destructive",
        });
      }
    }
  }

  async function connectKeythingsWallet() {
    setLoading(true);
    try {
      // Check if Keythings is installed
      if (!isKeythingsInstalled()) {
        toast({
          title: "Keythings Not Found",
          description: "Please install the Keythings browser extension to continue",
          variant: "destructive",
        });
        return;
      }

      console.log('🔌 Connecting to Keythings wallet...');

      // Request connection - this will prompt the wallet popup
      const accounts = await connectKeythings();

      if (!accounts || accounts.length === 0) {
        // User likely rejected the connection or has no accounts
        throw new Error("Connection cancelled or no accounts found. Please unlock your Keythings wallet and try again.");
      }

      const address = accounts[0];
      console.log('✅ Connected to Keythings:', address);

      // Clear old positions data (pools are global, not user-specific)
      setPositions([]);

      // Fetch balances using Keythings' native API
      console.log('📊 Fetching balances via Keythings...');

      const { getNormalizedBalances } = await import('@/lib/keythings-provider');
      const balances = await getNormalizedBalances(address);

      console.log('✅ Keythings balances:', balances);

      // Fetch metadata (symbol, decimals) for each token
      console.log('🔍 Fetching token metadata for each token...');
      const { fetchTokenMetadata } = await import('@/lib/keeta-client');

      const tokens = await Promise.all(
        balances.map(async (bal: any) => {
          const metadata = await fetchTokenMetadata(bal.token);
          const balanceValue = BigInt(bal.balance);
          const decimals = metadata.decimals || 9;
          const balanceFormatted = (Number(balanceValue) / Math.pow(10, decimals)).toFixed(decimals);

          return {
            address: bal.token,
            symbol: metadata.symbol,
            balance: bal.balance,
            balanceFormatted,
            decimals,
          };
        })
      );

      console.log('✅ Tokens with metadata:', tokens);

      // For Keythings wallet, we use a placeholder seed since signing is done via extension
      const placeholderSeed = "0".repeat(64);

      // Create wallet object
      const walletData: KeetaWallet = {
        address,
        seed: placeholderSeed, // Not used for Keythings - signing is done via extension
        isKeythings: true,
        tokens,
      };

      setWallet(walletData);
      setKeythingsConnected(true);
      setKeythingsAddress(address);

      // Set up event listeners
      onAccountsChanged((accounts) => {
        console.log('👤 Keythings account changed:', accounts);
        if (accounts.length === 0) {
          // Disconnected
          disconnectWallet();
        } else {
          // Account switched - reconnect with new account
          connectKeythingsWallet();
        }
      });

      onDisconnect(() => {
        console.log('🔌 Keythings disconnected');
        disconnectWallet();
      });

      toast({
        title: "Keythings Connected!",
        description: `Connected to ${address.substring(0, 20)}...`,
      });

      // Save to localStorage (both for this component and header sync)
      localStorage.setItem("keetaWallet", JSON.stringify(walletData));
      localStorage.setItem('keythingsConnected', 'true');
      localStorage.setItem('keythingsAddress', address);

      // Fetch data (balances will be empty initially - need to implement Keythings balance fetching)
      console.log('📊 Loading pools and positions...');

      // Load pools
      await loadPools();

      // For positions, we'll need the actual implementation
      // For now, just log that we're connected
      console.log('✅ Keythings wallet connected successfully');

    } catch (error: any) {
      console.error('❌ Keythings connection error:', error);
      toast({
        title: "Connection Failed",
        description: error.message || "Failed to connect to Keythings wallet",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  function disconnectWallet() {
    setWallet(null);
    setKeythingsConnected(false);
    setKeythingsAddress(null);
    localStorage.removeItem("keetaWallet");
    // Also clear header connection markers
    localStorage.removeItem('keythingsConnected');
    localStorage.removeItem('keythingsAddress');
    // Only clear positions (user-specific), keep pools (public data)
    setPositions([]);
    toast({
      title: "Wallet Disconnected",
      description: "Your wallet has been disconnected",
    });
  }

  async function loadPools() {
    try {
      const poolsData = await fetchPools();
      console.log('🔍 Fetched pools data:', poolsData);
      if (poolsData && poolsData.length > 0) {
        console.log('🔍 First pool reserves:', {
          reserveAHuman: poolsData[0].reserveAHuman,
          reserveBHuman: poolsData[0].reserveBHuman
        });
      }
      setPools(poolsData || []);
    } catch (error) {
      console.error("Failed to fetch pools:", error);
    }
  }

  async function fetchPositions() {
    if (!wallet) return;

    try {
      let userPositions;

      if (wallet.isKeythings) {
        // Keythings wallet: Fetch positions from backend API (blockchain-first)
        console.log('📋 Fetching Keythings wallet positions from backend...');
        const response = await fetch(`${API_BASE}/liquidity/positions/${wallet.address}`);
        const data = await response.json();

        if (!data.success) {
          throw new Error(data.error || 'Failed to fetch positions');
        }

        userPositions = data.positions || [];
        console.log('✅ Keythings positions loaded from backend:', userPositions);
      } else {
        // Seed wallet: Fetch positions client-side
        console.log('📋 Fetching seed wallet positions client-side...');
        userPositions = await fetchLiquidityPositions(wallet.seed, wallet.accountIndex || 0);
        console.log('✅ Seed wallet positions loaded:', userPositions);
      }

      setPositions(userPositions);
    } catch (error) {
      console.error("Failed to fetch positions:", error);
      setPositions([]);
    }
  }

  async function executeSend() {
    if (!wallet || !sendToken || !sendRecipient || !sendAmount) return;

    setSending(true);
    try {
      const response = await fetch(`${API_BASE}/transfer/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderSeed: wallet.seed,
          recipientAddress: sendRecipient,
          tokenAddress: sendToken.address,
          amount: sendAmount,
        }),
      });

      const result = await response.json();

      if (result.success) {
        toast({
          title: "Transfer Successful!",
          description: `Sent ${sendAmount} ${sendToken.symbol} to ${sendRecipient.slice(0, 12)}...`,
        });

        // Close dialog and refresh balances
        setSendDialogOpen(false);
        await refreshBalances();
      } else {
        throw new Error(result.error || "Transfer failed");
      }
    } catch (error: any) {
      toast({
        title: "Transfer Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 2000);
    toast({
      title: "Copied!",
      description: "Address copied to clipboard",
    });
  }

  const value: KeetaWalletContextValue = {
    wallet,
    pools,
    positions,
    allPools,
    loading,
    keythingsConnected,
    keythingsAddress,
    keythingsAvailable,
    keythingsChecking,
    showAllTokens,
    setShowAllTokens,
    copiedAddress,
    tokenAddresses,
    tokenPrices,
    sortedTokens,
    displayedTokens,
    connectKeythingsWallet,
    disconnectWallet,
    refreshBalances,
    loadPools,
    fetchPositions,
    copyToClipboard,
    sendDialogOpen,
    setSendDialogOpen,
    sendToken,
    setSendToken,
    sendRecipient,
    setSendRecipient,
    sendAmount,
    setSendAmount,
    sending,
    executeSend,
  };

  return <KeetaWalletContext.Provider value={value}>{children}</KeetaWalletContext.Provider>;
}

export function useKeetaWallet() {
  const context = useContext(KeetaWalletContext);
  if (context === undefined) {
    throw new Error("useKeetaWallet must be used within a KeetaWalletProvider");
  }
  return context;
}
