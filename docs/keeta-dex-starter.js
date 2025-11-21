// Keeta DEX Starter Kit - Practical Implementation Examples
// This file contains working code patterns for building on Keeta Network

const { KeetaNetClient } = require('@keetanetwork/keetanet-client');
const bip39 = require('bip39');

// ============================================
// 1. CLIENT INITIALIZATION & WALLET MANAGEMENT
// ============================================

class KeetaWalletManager {
  constructor(network = 'test') {
    this.client = new KeetaNetClient({ 
      network: network,
      endpoint: network === 'test' 
        ? 'https://api.test.keeta.com' 
        : 'https://api.keeta.com'
    });
    this.wallets = new Map();
  }

  // Generate new wallet with mnemonic
  async generateWallet(label = 'default') {
    const mnemonic = bip39.generateMnemonic(256); // 24 words
    const wallet = await this.client.createWalletFromMnemonic(mnemonic, 0);
    
    this.wallets.set(label, {
      wallet,
      mnemonic,
      address: wallet.address,
      accountIndex: 0
    });

    console.log(`Wallet "${label}" created:`);
    console.log(`Address: ${wallet.address}`);
    console.log(`Mnemonic: ${mnemonic}`);
    console.log('⚠️  Save this mnemonic securely!');

    return this.wallets.get(label);
  }

  // Import wallet from mnemonic
  async importWallet(mnemonic, accountIndex = 0, label = 'imported') {
    const wallet = await this.client.createWalletFromMnemonic(mnemonic, accountIndex);
    
    this.wallets.set(label, {
      wallet,
      mnemonic,
      address: wallet.address,
      accountIndex
    });

    return this.wallets.get(label);
  }

  // Get wallet balance
  async getBalance(walletLabel, tokenAddress = null) {
    const walletData = this.wallets.get(walletLabel);
    if (!walletData) throw new Error(`Wallet "${walletLabel}" not found`);

    const balance = await this.client.getBalance(
      walletData.address,
      tokenAddress // null for native KEETA
    );

    return balance;
  }

  getWallet(label) {
    return this.wallets.get(label);
  }
}

// ============================================
// 2. TOKEN CREATION & MANAGEMENT
// ============================================

class KeetaTokenManager {
  constructor(client) {
    this.client = client;
    this.tokens = new Map();
  }

  // Create a new token
  async createToken(creatorWallet, params) {
    const tokenParams = {
      name: params.name || 'Test Token',
      symbol: params.symbol || 'TST',
      decimals: params.decimals || 8,
      initialSupply: params.initialSupply || 1000000,
      mintable: params.mintable !== false,
      burnable: params.burnable !== false,
      rules: params.rules || {
        whitelistEnabled: false,
        maxTransferAmount: null,
        requireKYC: false
      }
    };

    const result = await this.client.createToken(
      creatorWallet.wallet,
      tokenParams
    );

    const tokenData = {
      address: result.tokenAddress,
      ...tokenParams,
      creator: creatorWallet.address
    };

    this.tokens.set(params.symbol, tokenData);

    console.log(`✅ Token "${params.name}" created`);
    console.log(`   Symbol: ${params.symbol}`);
    console.log(`   Address: ${result.tokenAddress}`);
    console.log(`   Supply: ${params.initialSupply}`);

    return tokenData;
  }

  // Mint additional tokens
  async mintTokens(minterWallet, tokenSymbol, amount, recipient) {
    const token = this.tokens.get(tokenSymbol);
    if (!token) throw new Error(`Token "${tokenSymbol}" not found`);

    const result = await this.client.mintTokens({
      minterWallet: minterWallet.wallet,
      tokenAddress: token.address,
      amount,
      recipient
    });

    console.log(`✅ Minted ${amount} ${tokenSymbol} to ${recipient}`);
    return result;
  }

  // Transfer tokens
  async transfer(senderWallet, tokenSymbol, recipient, amount, memo = '') {
    const token = this.tokens.get(tokenSymbol);
    if (!token) throw new Error(`Token "${tokenSymbol}" not found`);

    const result = await this.client.sendTransaction({
      from: senderWallet.wallet,
      to: recipient,
      tokenAddress: token.address,
      amount,
      memo
    });

    console.log(`✅ Transferred ${amount} ${tokenSymbol}`);
    console.log(`   From: ${senderWallet.address}`);
    console.log(`   To: ${recipient}`);

    return result;
  }

  getToken(symbol) {
    return this.tokens.get(symbol);
  }

  getAllTokens() {
    return Array.from(this.tokens.values());
  }
}

// ============================================
// 3. LIQUIDITY POOL IMPLEMENTATION
// ============================================

class KeetaLiquidityPool {
  constructor(client, tokenA, tokenB, poolWallet) {
    this.client = client;
    this.tokenA = tokenA;
    this.tokenB = tokenB;
    this.poolWallet = poolWallet;
    this.lpToken = null;
    this.reserves = { reserveA: 0, reserveB: 0 };
    this.feeBasisPoints = 30; // 0.3% fee
  }

  // Initialize pool and create LP token
  async initialize(tokenManager) {
    const lpTokenParams = {
      name: `${this.tokenA.symbol}-${this.tokenB.symbol} Liquidity Pool`,
      symbol: `${this.tokenA.symbol}-${this.tokenB.symbol}-LP`,
      decimals: 18,
      initialSupply: 0,
      mintable: true,
      burnable: true
    };

    this.lpToken = await tokenManager.createToken(this.poolWallet, lpTokenParams);

    console.log(`🏊 Pool initialized: ${this.tokenA.symbol}/${this.tokenB.symbol}`);
    console.log(`   LP Token: ${this.lpToken.address}`);

    return this.lpToken;
  }

  // Add liquidity to pool
  async addLiquidity(userWallet, amountA, amountB, tokenManager) {
    // Update reserves
    await this.updateReserves();

    let lpAmount;
    
    // First liquidity provider
    if (this.reserves.reserveA === 0 && this.reserves.reserveB === 0) {
      lpAmount = Math.sqrt(amountA * amountB);
    } else {
      // Calculate proportional liquidity
      const liquidityA = (amountA * this.totalSupply) / this.reserves.reserveA;
      const liquidityB = (amountB * this.totalSupply) / this.reserves.reserveB;
      lpAmount = Math.min(liquidityA, liquidityB);
    }

    // Transfer tokens to pool
    await tokenManager.transfer(
      userWallet,
      this.tokenA.symbol,
      this.poolWallet.address,
      amountA,
      'Add liquidity'
    );

    await tokenManager.transfer(
      userWallet,
      this.tokenB.symbol,
      this.poolWallet.address,
      amountB,
      'Add liquidity'
    );

    // Mint LP tokens to user
    await tokenManager.mintTokens(
      this.poolWallet,
      this.lpToken.symbol,
      lpAmount,
      userWallet.address
    );

    // Update reserves
    this.reserves.reserveA += amountA;
    this.reserves.reserveB += amountB;

    console.log(`✅ Liquidity added to ${this.tokenA.symbol}/${this.tokenB.symbol}`);
    console.log(`   Deposited: ${amountA} ${this.tokenA.symbol}, ${amountB} ${this.tokenB.symbol}`);
    console.log(`   LP Tokens: ${lpAmount}`);

    return { lpAmount, amountA, amountB };
  }

  // Remove liquidity from pool
  async removeLiquidity(userWallet, lpAmount, tokenManager) {
    await this.updateReserves();

    // Calculate token amounts to return
    const totalLP = this.totalSupply || 1;
    const amountA = (lpAmount * this.reserves.reserveA) / totalLP;
    const amountB = (lpAmount * this.reserves.reserveB) / totalLP;

    // Burn LP tokens (user needs to approve first)
    await this.client.burnTokens({
      wallet: userWallet.wallet,
      tokenAddress: this.lpToken.address,
      amount: lpAmount
    });

    // Return underlying tokens
    await tokenManager.transfer(
      this.poolWallet,
      this.tokenA.symbol,
      userWallet.address,
      amountA,
      'Remove liquidity'
    );

    await tokenManager.transfer(
      this.poolWallet,
      this.tokenB.symbol,
      userWallet.address,
      amountB,
      'Remove liquidity'
    );

    // Update reserves
    this.reserves.reserveA -= amountA;
    this.reserves.reserveB -= amountB;

    console.log(`✅ Liquidity removed from ${this.tokenA.symbol}/${this.tokenB.symbol}`);
    console.log(`   Received: ${amountA} ${this.tokenA.symbol}, ${amountB} ${this.tokenB.symbol}`);
    console.log(`   Burned LP: ${lpAmount}`);

    return { amountA, amountB };
  }

  // Swap tokens using constant product formula
  async swap(userWallet, fromTokenSymbol, amountIn, minAmountOut, tokenManager) {
    await this.updateReserves();

    const isSwapAtoB = fromTokenSymbol === this.tokenA.symbol;
    const [reserveIn, reserveOut] = isSwapAtoB
      ? [this.reserves.reserveA, this.reserves.reserveB]
      : [this.reserves.reserveB, this.reserves.reserveA];
    
    const toTokenSymbol = isSwapAtoB ? this.tokenB.symbol : this.tokenA.symbol;

    // Calculate output with fee (0.3%)
    const amountOut = this.calculateSwapOutput(amountIn, reserveIn, reserveOut);

    // Slippage check
    if (amountOut < minAmountOut) {
      throw new Error(`Slippage too high: expected ${minAmountOut}, got ${amountOut}`);
    }

    // Execute swap
    await tokenManager.transfer(
      userWallet,
      fromTokenSymbol,
      this.poolWallet.address,
      amountIn,
      'Swap'
    );

    await tokenManager.transfer(
      this.poolWallet,
      toTokenSymbol,
      userWallet.address,
      amountOut,
      'Swap'
    );

    // Update reserves
    if (isSwapAtoB) {
      this.reserves.reserveA += amountIn;
      this.reserves.reserveB -= amountOut;
    } else {
      this.reserves.reserveB += amountIn;
      this.reserves.reserveA -= amountOut;
    }

    console.log(`✅ Swap executed`);
    console.log(`   Paid: ${amountIn} ${fromTokenSymbol}`);
    console.log(`   Received: ${amountOut} ${toTokenSymbol}`);

    return { amountIn, amountOut, fromTokenSymbol, toTokenSymbol };
  }

  // Calculate swap output using constant product (x * y = k)
  calculateSwapOutput(amountIn, reserveIn, reserveOut) {
    const amountInWithFee = amountIn * (10000 - this.feeBasisPoints);
    const numerator = amountInWithFee * reserveOut;
    const denominator = (reserveIn * 10000) + amountInWithFee;
    return Math.floor(numerator / denominator);
  }

  // Get current price
  getPrice() {
    if (this.reserves.reserveA === 0) return 0;
    return this.reserves.reserveB / this.reserves.reserveA;
  }

  // Update reserves from blockchain
  async updateReserves() {
    this.reserves.reserveA = await this.client.getBalance(
      this.poolWallet.address,
      this.tokenA.address
    );
    this.reserves.reserveB = await this.client.getBalance(
      this.poolWallet.address,
      this.tokenB.address
    );
    this.totalSupply = await this.client.getTotalSupply(this.lpToken.address);
  }
}

// ============================================
// 4. DEX FACTORY & ROUTER
// ============================================

class KeetaDEXFactory {
  constructor(client, factoryWallet) {
    this.client = client;
    this.factoryWallet = factoryWallet;
    this.pools = new Map();
    this.tokenManager = new KeetaTokenManager(client);
  }

  // Create a new trading pair
  async createPair(tokenA, tokenB) {
    const pairKey = this.getPairKey(tokenA, tokenB);
    
    if (this.pools.has(pairKey)) {
      console.log(`ℹ️  Pair ${tokenA.symbol}/${tokenB.symbol} already exists`);
      return this.pools.get(pairKey);
    }

    const pool = new KeetaLiquidityPool(
      this.client,
      tokenA,
      tokenB,
      this.factoryWallet
    );

    await pool.initialize(this.tokenManager);
    this.pools.set(pairKey, pool);

    console.log(`✅ Trading pair created: ${tokenA.symbol}/${tokenB.symbol}`);

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
    const sorted = [tokenA.address, tokenB.address].sort();
    return `${sorted[0]}-${sorted[1]}`;
  }
}

// ============================================
// 5. USAGE EXAMPLES
// ============================================

async function exampleSetup() {
  console.log('🚀 Keeta DEX Setup Example\n');

  // 1. Initialize wallet manager
  const walletManager = new KeetaWalletManager('test');
  
  // Create wallets
  const deployer = await walletManager.generateWallet('deployer');
  const liquidityProvider = await walletManager.generateWallet('lp');
  const trader = await walletManager.generateWallet('trader');

  // 2. Initialize DEX factory
  const factory = new KeetaDEXFactory(
    walletManager.client,
    deployer
  );

  // 3. Create tokens
  console.log('\n📝 Creating tokens...');
  
  const tokenA = await factory.tokenManager.createToken(deployer, {
    name: 'Token A',
    symbol: 'TKA',
    initialSupply: 1000000
  });

  const tokenB = await factory.tokenManager.createToken(deployer, {
    name: 'Token B',
    symbol: 'TKB',
    initialSupply: 1000000
  });

  // 4. Create trading pair
  console.log('\n🏊 Creating liquidity pool...');
  const pool = await factory.createPair(tokenA, tokenB);

  // 5. Distribute tokens to LP and trader
  console.log('\n💸 Distributing tokens...');
  await factory.tokenManager.transfer(deployer, 'TKA', liquidityProvider.address, 100000);
  await factory.tokenManager.transfer(deployer, 'TKB', liquidityProvider.address, 100000);
  await factory.tokenManager.transfer(deployer, 'TKA', trader.address, 10000);

  // 6. Add liquidity
  console.log('\n➕ Adding liquidity...');
  await pool.addLiquidity(
    liquidityProvider,
    10000, // 10k Token A
    10000, // 10k Token B
    factory.tokenManager
  );

  // 7. Execute swap
  console.log('\n🔄 Executing swap...');
  await pool.swap(
    trader,
    'TKA',
    1000,  // Swap 1000 Token A
    900,   // Minimum 900 Token B (10% slippage tolerance)
    factory.tokenManager
  );

  console.log('\n✅ DEX setup complete!');
  console.log('\n📊 Pool Stats:');
  console.log(`   Reserve A: ${pool.reserves.reserveA} TKA`);
  console.log(`   Reserve B: ${pool.reserves.reserveB} TKB`);
  console.log(`   Price: ${pool.getPrice().toFixed(4)} TKB per TKA`);
}

// ============================================
// 6. TESTING UTILITIES
// ============================================

async function requestTestnetFaucet(address) {
  console.log(`Requesting testnet tokens for ${address}`);
  console.log('Visit: https://faucet.test.keeta.com');
  // In production, implement actual faucet API call
}

async function checkBalances(walletManager, label) {
  const wallet = walletManager.getWallet(label);
  const balance = await walletManager.getBalance(label);
  
  console.log(`\n💰 Balance for ${label} (${wallet.address}):`);
  console.log(`   KEETA: ${balance}`);
}

// ============================================
// EXPORT FOR USE IN OTHER FILES
// ============================================

module.exports = {
  KeetaWalletManager,
  KeetaTokenManager,
  KeetaLiquidityPool,
  KeetaDEXFactory,
  exampleSetup,
  requestTestnetFaucet,
  checkBalances
};

// ============================================
// RUN EXAMPLE (uncomment to test)
// ============================================

// exampleSetup().catch(console.error);
