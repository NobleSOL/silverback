# Keeta Network DEX Development Guide
## Complete Guide to Creating LP Tokens and Trading Pairs

---

## Table of Contents
1. [Overview of Keeta Network](#overview)
2. [Architecture & Technology](#architecture)
3. [Development Environment Setup](#setup)
4. [Creating Tokens on Keeta](#creating-tokens)
5. [Creating Liquidity Pairs & LP Tokens](#creating-lp-tokens)
6. [DEX Implementation](#dex-implementation)
7. [Testnet Resources](#testnet-resources)
8. [Key Considerations](#considerations)

---

## Overview of Keeta Network {#overview}

### What is Keeta Network?

Keeta Network is a high-performance Layer-1 blockchain designed specifically for **payments, asset transfers, and cross-chain interoperability**. Key features include:

- **10M TPS capacity** with 400ms settlement times
- **Built-in compliance** (KYC/AML) via digital certificates
- **Native tokenization** and asset management
- **Cross-chain bridges** (Base, other networks)
- **DAG-based architecture** with Delegated Proof of Stake (dPoS)

### Current Status

- **Mainnet**: Launched September 22, 2025
- **Testnet**: Active since March 2025
- **Token (KTA)**: Listed on Base (Aerodrome DEX), Coinbase, Kraken, and other exchanges
- **Backing**: $17M funding led by former Google CEO Eric Schmidt

---

## Architecture & Technology {#architecture}

### Core Technical Stack

1. **Hybrid DAG + dPoS Consensus**
   - Virtual DAG structure (each account has its own chain)
   - Delegated Proof of Stake for consensus
   - Parallel transaction processing

2. **Native Features**
   - Built-in token engine (create/manage tokens at protocol level)
   - Atomic swaps capability
   - Rules engine for compliance and permissions
   - Cross-chain anchors for interoperability

3. **Compliance Integration**
   - X.509 certificates for identity
   - KYC/AML built into protocol
   - Footprint as primary KYC provider
   - SOLO partnership for on-chain credit bureau

### Key Differences from EVM Chains

Unlike Ethereum-based DEXs (Uniswap, SushiSwap), Keeta has:
- **Protocol-level tokenization** (no smart contract deployment needed for basic tokens)
- **Built-in swap functionality** via atomic swaps
- **Native compliance** rather than add-on modules
- **Account-based model** with individual transaction chains

---

## Development Environment Setup {#setup}

### Prerequisites

```bash
# Node.js 18+ (Ubuntu)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 18
nvm use 18

# Package manager (pnpm recommended)
npm install -g pnpm
```

### Install Keeta SDK

```bash
# Create new project
mkdir keeta-dex
cd keeta-dex
pnpm init

# Install Keeta client
pnpm add @keetanetwork/keetanet-client

# Optional: BIP39 for mnemonic generation
pnpm add bip39
```

### Connect to Testnet

```javascript
const { KeetaNetClient } = require('@keetanetwork/keetanet-client');

// Initialize client for testnet
const client = new KeetaNetClient({
  network: 'test', // or 'mainnet'
  endpoint: 'https://api.test.keeta.com' // testnet endpoint
});

// Test connection
async function testConnection() {
  const status = await client.getNetworkStatus();
  console.log('Network status:', status);
}
```

---

## Creating Tokens on Keeta {#creating-tokens}

### Understanding Keeta Tokenization

Keeta has **native tokenization** at the protocol level. Unlike EVM chains where you deploy ERC-20 contracts, on Keeta you use the built-in token engine.

### Token Creation Process

```javascript
const { KeetaNetClient } = require('@keetanetwork/keetanet-client');

async function createToken(creatorWallet) {
  const client = new KeetaNetClient({ network: 'test' });
  
  // Token parameters
  const tokenParams = {
    name: 'My Test Token',
    symbol: 'MTT',
    decimals: 8,
    initialSupply: 1000000, // 1 million tokens
    mintable: true, // Can mint more later
    burnable: true, // Can burn tokens
    
    // Optional: Compliance rules
    rules: {
      whitelistEnabled: false,
      maxTransferAmount: null,
      requireKYC: false
    }
  };
  
  // Create token
  const tokenResult = await client.createToken(
    creatorWallet,
    tokenParams
  );
  
  console.log('Token created:', tokenResult.tokenAddress);
  return tokenResult.tokenAddress;
}
```

### Token Management Operations

```javascript
// Mint additional tokens (if mintable)
async function mintTokens(minterWallet, tokenAddress, amount, recipient) {
  const result = await client.mintTokens({
    minterWallet,
    tokenAddress,
    amount,
    recipient
  });
  return result;
}

// Burn tokens (if burnable)
async function burnTokens(wallet, tokenAddress, amount) {
  const result = await client.burnTokens({
    wallet,
    tokenAddress,
    amount
  });
  return result;
}

// Transfer tokens
async function transferTokens(senderWallet, tokenAddress, recipient, amount) {
  const result = await client.sendTransaction({
    from: senderWallet,
    to: recipient,
    tokenAddress,
    amount,
    memo: 'Token transfer'
  });
  return result;
}
```

---

## Creating Liquidity Pairs & LP Tokens {#creating-lp-tokens}

### Understanding Keeta's Swap Mechanism

Based on the research, Keeta implements **atomic swaps** at the protocol level. However, for a full-featured DEX similar to Uniswap (with liquidity pools and LP tokens), you'll need to build on top of these primitives.

### Approach 1: Native Atomic Swaps (Protocol Level)

```javascript
// Direct swap between two assets
async function atomicSwap(wallet, tokenA, tokenB, amountA, minAmountB) {
  const client = new KeetaNetClient({ network: 'test' });
  
  const swapParams = {
    wallet,
    fromToken: tokenA,
    toToken: tokenB,
    fromAmount: amountA,
    minToAmount: minAmountB,
    slippage: 0.01 // 1% slippage tolerance
  };
  
  // Execute atomic swap
  const result = await client.executeSwap(swapParams);
  return result;
}
```

### Approach 2: Building a Liquidity Pool System

Since Keeta doesn't appear to have native AMM liquidity pools like Uniswap v2, you'll need to implement the pool logic. Here's a conceptual implementation:

```javascript
// Liquidity Pool Manager
class KeetaLiquidityPool {
  constructor(client, tokenA, tokenB) {
    this.client = client;
    this.tokenA = tokenA;
    this.tokenB = tokenB;
    this.lpTokenAddress = null;
  }
  
  // Initialize pool and create LP token
  async initialize(poolWallet) {
    // Create LP token to represent pool shares
    const lpTokenParams = {
      name: `${this.tokenA.symbol}-${this.tokenB.symbol} LP`,
      symbol: `${this.tokenA.symbol}-${this.tokenB.symbol}-LP`,
      decimals: 18,
      initialSupply: 0, // Minted as liquidity is added
      mintable: true,
      burnable: true
    };
    
    const lpToken = await this.client.createToken(
      poolWallet,
      lpTokenParams
    );
    
    this.lpTokenAddress = lpToken.tokenAddress;
    
    // Store pool metadata
    await this.storePoolMetadata(poolWallet);
    
    return this.lpTokenAddress;
  }
  
  // Add liquidity to pool
  async addLiquidity(userWallet, amountA, amountB) {
    // Calculate LP tokens to mint
    const lpAmount = await this.calculateLPTokens(amountA, amountB);
    
    // Transfer tokens to pool
    await this.client.sendTransaction({
      from: userWallet,
      to: this.poolAddress,
      tokenAddress: this.tokenA.address,
      amount: amountA
    });
    
    await this.client.sendTransaction({
      from: userWallet,
      to: this.poolAddress,
      tokenAddress: this.tokenB.address,
      amount: amountB
    });
    
    // Mint LP tokens to user
    await this.client.mintTokens({
      minterWallet: this.poolWallet,
      tokenAddress: this.lpTokenAddress,
      amount: lpAmount,
      recipient: userWallet.address
    });
    
    return { lpAmount, amountA, amountB };
  }
  
  // Remove liquidity from pool
  async removeLiquidity(userWallet, lpAmount) {
    // Calculate token amounts to return
    const { amountA, amountB } = await this.calculateTokensFromLP(lpAmount);
    
    // Burn LP tokens
    await this.client.burnTokens({
      wallet: userWallet,
      tokenAddress: this.lpTokenAddress,
      amount: lpAmount
    });
    
    // Return underlying tokens
    await this.client.sendTransaction({
      from: this.poolWallet,
      to: userWallet.address,
      tokenAddress: this.tokenA.address,
      amount: amountA
    });
    
    await this.client.sendTransaction({
      from: this.poolWallet,
      to: userWallet.address,
      tokenAddress: this.tokenB.address,
      amount: amountB
    });
    
    return { amountA, amountB };
  }
  
  // Swap tokens using pool
  async swap(userWallet, fromToken, toToken, amountIn, minAmountOut) {
    // Get pool reserves
    const reserves = await this.getReserves();
    
    // Calculate output amount (constant product formula: x*y=k)
    const amountOut = this.calculateSwapOutput(
      amountIn,
      reserves.reserveIn,
      reserves.reserveOut
    );
    
    if (amountOut < minAmountOut) {
      throw new Error('Slippage tolerance exceeded');
    }
    
    // Execute swap
    await this.client.sendTransaction({
      from: userWallet,
      to: this.poolAddress,
      tokenAddress: fromToken,
      amount: amountIn
    });
    
    await this.client.sendTransaction({
      from: this.poolWallet,
      to: userWallet.address,
      tokenAddress: toToken,
      amount: amountOut
    });
    
    return { amountIn, amountOut };
  }
  
  // Calculate LP tokens for liquidity addition
  calculateLPTokens(amountA, amountB) {
    // Implement constant product formula
    // For first liquidity: sqrt(amountA * amountB)
    // For subsequent: min(amountA/reserveA, amountB/reserveB) * totalLP
    return Math.sqrt(amountA * amountB);
  }
  
  // Calculate swap output
  calculateSwapOutput(amountIn, reserveIn, reserveOut) {
    // Constant product formula with 0.3% fee
    const amountInWithFee = amountIn * 997;
    const numerator = amountInWithFee * reserveOut;
    const denominator = (reserveIn * 1000) + amountInWithFee;
    return numerator / denominator;
  }
  
  // Get current pool reserves
  async getReserves() {
    const balanceA = await this.client.getBalance(
      this.poolAddress,
      this.tokenA.address
    );
    const balanceB = await this.client.getBalance(
      this.poolAddress,
      this.tokenB.address
    );
    
    return {
      reserveA: balanceA,
      reserveB: balanceB
    };
  }
}
```

### Using the Liquidity Pool

```javascript
// Example: Create and use a liquidity pool
async function setupDEXPool() {
  const client = new KeetaNetClient({ network: 'test' });
  
  // Create two test tokens
  const tokenA = await createToken('TOKEN_A', 'TKA', 1000000);
  const tokenB = await createToken('TOKEN_B', 'TKB', 1000000);
  
  // Initialize liquidity pool
  const pool = new KeetaLiquidityPool(client, tokenA, tokenB);
  await pool.initialize(poolWallet);
  
  // Add initial liquidity
  const liquidityResult = await pool.addLiquidity(
    userWallet,
    10000, // 10k Token A
    10000  // 10k Token B
  );
  
  console.log('LP Tokens received:', liquidityResult.lpAmount);
  
  // Perform a swap
  const swapResult = await pool.swap(
    traderWallet,
    tokenA.address,
    tokenB.address,
    100,  // Swap 100 Token A
    95    // Minimum 95 Token B (5% slippage)
  );
  
  console.log('Swapped:', swapResult);
}
```

---

## DEX Implementation {#dex-implementation}

### Complete DEX Factory Pattern

```javascript
// DEX Factory for managing multiple pools
class KeetaDEXFactory {
  constructor(client) {
    this.client = client;
    this.pools = new Map();
  }
  
  // Create a new trading pair
  async createPair(tokenA, tokenB, factoryWallet) {
    const pairKey = this.getPairKey(tokenA, tokenB);
    
    if (this.pools.has(pairKey)) {
      throw new Error('Pair already exists');
    }
    
    const pool = new KeetaLiquidityPool(this.client, tokenA, tokenB);
    await pool.initialize(factoryWallet);
    
    this.pools.set(pairKey, pool);
    
    return pool;
  }
  
  // Get existing pair
  getPair(tokenA, tokenB) {
    const pairKey = this.getPairKey(tokenA, tokenB);
    return this.pools.get(pairKey);
  }
  
  // Get all pairs
  getAllPairs() {
    return Array.from(this.pools.values());
  }
  
  getPairKey(tokenA, tokenB) {
    // Ensure consistent ordering
    const sorted = [tokenA.address, tokenB.address].sort();
    return `${sorted[0]}-${sorted[1]}`;
  }
}

// Example usage
async function deployDEX() {
  const client = new KeetaNetClient({ network: 'test' });
  const factory = new KeetaDEXFactory(client);
  
  // Create native token (KEETA) to stablecoin pair
  const KEETA = { address: 'native', symbol: 'KEETA' };
  const USDC = await createToken('USD Coin', 'USDC', 1000000);
  
  const pool = await factory.createPair(KEETA, USDC, factoryWallet);
  
  // Add initial liquidity
  await pool.addLiquidity(
    liquidityProvider,
    1000,  // 1000 KEETA
    50000  // 50000 USDC ($0.05 per KEETA)
  );
}
```

### Router Pattern for Multi-Hop Swaps

```javascript
class KeetaDEXRouter {
  constructor(factory) {
    this.factory = factory;
  }
  
  // Find best swap route
  async findBestRoute(tokenIn, tokenOut, amountIn) {
    // Direct route
    const directPair = this.factory.getPair(tokenIn, tokenOut);
    
    if (directPair) {
      const directAmount = await directPair.calculateSwapOutput(
        amountIn,
        (await directPair.getReserves()).reserveIn,
        (await directPair.getReserves()).reserveOut
      );
      
      return {
        path: [tokenIn, tokenOut],
        amountOut: directAmount,
        pairs: [directPair]
      };
    }
    
    // Multi-hop routes (e.g., TokenA -> KEETA -> TokenB)
    // Implementation depends on your token ecosystem
  }
  
  // Execute swap with routing
  async swapExactTokensForTokens(
    userWallet,
    amountIn,
    minAmountOut,
    path,
    deadline
  ) {
    // Verify deadline
    if (Date.now() > deadline) {
      throw new Error('Transaction expired');
    }
    
    // Execute swaps along path
    let currentAmount = amountIn;
    
    for (let i = 0; i < path.length - 1; i++) {
      const pair = this.factory.getPair(path[i], path[i + 1]);
      
      const result = await pair.swap(
        userWallet,
        path[i],
        path[i + 1],
        currentAmount,
        0 // No minimum for intermediate swaps
      );
      
      currentAmount = result.amountOut;
    }
    
    if (currentAmount < minAmountOut) {
      throw new Error('Insufficient output amount');
    }
    
    return currentAmount;
  }
}
```

---

## Testnet Resources {#testnet-resources}

### Essential Links

- **Testnet Wallet**: https://wallet.test.keeta.com
- **Testnet Explorer**: https://explorer.test.keeta.com
- **Testnet Faucet**: https://faucet.test.keeta.com
- **SDK Documentation**: https://static.test.keeta.com/docs/
- **Main Documentation**: https://docs.keeta.com

### Getting Testnet Tokens

```javascript
// Request testnet KEETA from faucet
async function getTestnetTokens(walletAddress) {
  // Visit https://faucet.test.keeta.com and enter your address
  // Or use faucet API if available
  
  const response = await fetch('https://faucet.test.keeta.com/api/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: walletAddress })
  });
  
  return response.json();
}
```

### Wallet Generation

```javascript
const bip39 = require('bip39');
const { KeetaNetClient } = require('@keetanetwork/keetanet-client');

// Generate new wallet
async function generateWallet() {
  const mnemonic = bip39.generateMnemonic(256); // 24 words
  const client = new KeetaNetClient({ network: 'test' });
  
  const wallet = await client.createWalletFromMnemonic(mnemonic, 0);
  
  return {
    address: wallet.address,
    publicKey: wallet.publicKey,
    mnemonic: mnemonic,
    accountIndex: 0
  };
}

// Import existing wallet
async function importWallet(mnemonic, accountIndex = 0) {
  const client = new KeetaNetClient({ network: 'test' });
  return await client.createWalletFromMnemonic(mnemonic, accountIndex);
}
```

---

## Key Considerations {#considerations}

### 1. **Keeta vs Traditional EVM DEXs**

| Feature | Keeta Network | Uniswap/EVM |
|---------|--------------|-------------|
| Token Creation | Protocol-level (no contracts) | Deploy ERC-20 contract |
| Swaps | Atomic swaps built-in | Smart contract logic |
| LP Tokens | Need custom implementation | Built into protocol |
| Gas Fees | KEETA tokens | ETH/network token |
| Compliance | Native KYC/AML | Add-on modules |

### 2. **Important Limitations**

- **Early Stage**: Keeta mainnet just launched (Sept 2025), ecosystem is still developing
- **Documentation**: SDK docs are limited compared to mature chains
- **No Native AMM**: Unlike Uniswap, there's no built-in automated market maker
- **Developer Adoption**: Smaller developer community vs Ethereum

### 3. **Adapting Silverback DEX**

Your existing Silverback DEX codebase (designed for EVM/Base) will need significant adaptation:

**What can be reused:**
- Frontend React/Vite structure
- UI/UX components
- Trading logic concepts

**What needs rebuilding:**
- Smart contracts → Keeta SDK calls
- Web3 integration → KeetaNet Client
- Pool management logic
- LP token implementation

### 4. **Recommended Architecture**

```
Frontend (React/Vite)
    ↓
Keeta Client SDK
    ↓
Your DEX Layer (pools, routing)
    ↓
Keeta Network (protocol-level swaps, tokens)
```

### 5. **Testing Strategy**

1. **Start Simple**: Test basic token creation and transfers
2. **Build Gradually**: Implement single-pair swaps before full DEX
3. **Use Testnet**: Thoroughly test on testnet before mainnet
4. **Monitor Controversies**: Be aware of past testnet controversies (see research notes)

### 6. **Cross-Chain Bridge**

Keeta has a **Base Anchor** for bridging assets:

```javascript
// Bridge tokens from Base to Keeta
async function bridgeFromBase(wallet, tokenAddress, amount) {
  // Use Keeta's Base anchor
  const result = await client.bridgeAsset({
    from: 'base',
    to: 'keeta',
    token: tokenAddress,
    amount: amount,
    wallet: wallet
  });
  
  return result;
}
```

---

## Next Steps

1. **Set up development environment** (Node.js, SDK)
2. **Create test wallets** and get testnet tokens
3. **Experiment with token creation** on testnet
4. **Implement basic swap functionality** using atomic swaps
5. **Build liquidity pool system** with LP tokens
6. **Develop frontend** to interact with your DEX
7. **Test thoroughly** before considering mainnet deployment

---

## Additional Resources

- **GitHub Examples**: https://github.com/impyrobot/keetanet-utilities
- **Community**: Discord at discord.com/invite/keeta
- **Twitter**: @KeetaNetwork
- **Unofficial Utilities**: Search for "keetanet" on GitHub for community tools

---

## Important Warnings

1. **Controversy Alert**: In June 2025, there were accusations about the testnet being "fake" which were later addressed by the founder. Do your own research.

2. **Early Stage Risk**: Keeta is very new (mainnet Sept 2025). Expect bugs, changes, and limited tooling.

3. **No Audit Yet**: If building production DEX, ensure thorough security audits.

4. **Compliance Requirements**: Keeta's KYC/compliance features may affect your DEX design decisions.

---

**This guide provides a comprehensive starting point for building your DEX on Keeta Network testnet. The actual implementation will depend on Keeta's final API design and available SDK methods.**
