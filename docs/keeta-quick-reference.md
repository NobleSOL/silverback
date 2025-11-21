# Keeta Network Quick Reference Guide

## Essential Commands & Patterns

### Project Setup

```bash
# Initialize project
mkdir my-keeta-dex && cd my-keeta-dex
npm init -y

# Install dependencies
npm install @keetanetwork/keetanet-client bip39

# For TypeScript
npm install -D @types/node typescript
```

### Client Initialization

```javascript
const { KeetaNetClient } = require('@keetanetwork/keetanet-client');

// Testnet
const testClient = new KeetaNetClient({ network: 'test' });

// Mainnet
const mainClient = new KeetaNetClient({ network: 'mainnet' });
```

---

## Wallet Operations

### Create New Wallet

```javascript
const bip39 = require('bip39');

const mnemonic = bip39.generateMnemonic(256); // 24 words
const wallet = await client.createWalletFromMnemonic(mnemonic, 0);

console.log('Address:', wallet.address);
console.log('Mnemonic:', mnemonic); // SAVE THIS SECURELY!
```

### Import Wallet

```javascript
const wallet = await client.createWalletFromMnemonic(
  'your twelve or twenty four word mnemonic phrase here',
  0 // account index
);
```

### Check Balance

```javascript
// Native KEETA balance
const balance = await client.getBalance(address);

// Token balance
const tokenBalance = await client.getBalance(address, tokenAddress);
```

---

## Token Operations

### Create Token

```javascript
const token = await client.createToken(wallet, {
  name: 'My Token',
  symbol: 'MTK',
  decimals: 8,
  initialSupply: 1000000,
  mintable: true,
  burnable: true
});

console.log('Token address:', token.tokenAddress);
```

### Transfer Tokens

```javascript
const result = await client.sendTransaction({
  from: senderWallet,
  to: recipientAddress,
  tokenAddress: tokenAddress, // or null for KEETA
  amount: 1000,
  memo: 'Payment for services'
});
```

### Mint Tokens

```javascript
await client.mintTokens({
  minterWallet: wallet,
  tokenAddress: tokenAddress,
  amount: 10000,
  recipient: recipientAddress
});
```

### Burn Tokens

```javascript
await client.burnTokens({
  wallet: wallet,
  tokenAddress: tokenAddress,
  amount: 5000
});
```

---

## Swap/DEX Operations

### Atomic Swap (Protocol Level)

```javascript
const swap = await client.executeSwap({
  wallet: traderWallet,
  fromToken: tokenAAddress,
  toToken: tokenBAddress,
  fromAmount: 100,
  minToAmount: 95, // slippage protection
  slippage: 0.05 // 5%
});
```

### Calculate Swap Output (Constant Product)

```javascript
function getAmountOut(amountIn, reserveIn, reserveOut, feeBps = 30) {
  const amountInWithFee = amountIn * (10000 - feeBps);
  const numerator = amountInWithFee * reserveOut;
  const denominator = (reserveIn * 10000) + amountInWithFee;
  return Math.floor(numerator / denominator);
}

// Example
const output = getAmountOut(
  1000,   // input amount
  50000,  // input reserve
  50000,  // output reserve
  30      // 0.3% fee
);
```

### Calculate Price Impact

```javascript
function getPriceImpact(amountIn, reserveIn, reserveOut) {
  const priceBeforeSwap = reserveOut / reserveIn;
  const amountOut = getAmountOut(amountIn, reserveIn, reserveOut);
  const priceAfterSwap = (reserveOut - amountOut) / (reserveIn + amountIn);
  
  const impact = ((priceBeforeSwap - priceAfterSwap) / priceBeforeSwap) * 100;
  return impact;
}
```

---

## Liquidity Pool Formulas

### Initial Liquidity

```javascript
// For first LP
const lpTokens = Math.sqrt(amountA * amountB);
```

### Add Liquidity (Existing Pool)

```javascript
const liquidityA = (amountA * totalLPSupply) / reserveA;
const liquidityB = (amountB * totalLPSupply) / reserveB;
const lpTokens = Math.min(liquidityA, liquidityB);
```

### Remove Liquidity

```javascript
const amountA = (lpTokens * reserveA) / totalLPSupply;
const amountB = (lpTokens * reserveB) / totalLPSupply;
```

### K Value (Constant Product)

```javascript
const k = reserveA * reserveB; // Must remain constant after swap
```

---

## Network Information

### Testnet

- **RPC**: `https://api.test.keeta.com`
- **Wallet**: https://wallet.test.keeta.com
- **Explorer**: https://explorer.test.keeta.com
- **Faucet**: https://faucet.test.keeta.com

### Mainnet

- **RPC**: `https://api.keeta.com`
- **Wallet**: https://wallet.keeta.com
- **Explorer**: https://explorer.keeta.com

---

## Common Patterns

### Transaction with Retry

```javascript
async function sendWithRetry(client, txParams, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await client.sendTransaction(txParams);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}
```

### Batch Token Transfers

```javascript
async function batchTransfer(wallet, recipients) {
  const results = [];
  
  for (const recipient of recipients) {
    const result = await client.sendTransaction({
      from: wallet,
      to: recipient.address,
      amount: recipient.amount,
      tokenAddress: recipient.tokenAddress,
      memo: recipient.memo || ''
    });
    
    results.push(result);
  }
  
  return results;
}
```

### Get All Pool Reserves

```javascript
async function getAllReserves(poolAddress, tokenAddresses) {
  const reserves = {};
  
  for (const token of tokenAddresses) {
    reserves[token] = await client.getBalance(poolAddress, token);
  }
  
  return reserves;
}
```

---

## Error Handling

```javascript
try {
  const result = await client.sendTransaction({...});
} catch (error) {
  if (error.code === 'INSUFFICIENT_BALANCE') {
    console.error('Not enough tokens');
  } else if (error.code === 'SLIPPAGE_EXCEEDED') {
    console.error('Price moved too much');
  } else if (error.code === 'INVALID_SIGNATURE') {
    console.error('Wallet authentication failed');
  } else {
    console.error('Unknown error:', error.message);
  }
}
```

---

## Testing Checklist

- [ ] Generate test wallets
- [ ] Request testnet KEETA from faucet
- [ ] Create test tokens
- [ ] Test token transfers
- [ ] Create liquidity pool
- [ ] Add initial liquidity
- [ ] Test swaps with various amounts
- [ ] Test removing liquidity
- [ ] Test edge cases (zero amounts, insufficient balance)
- [ ] Test slippage protection
- [ ] Monitor gas costs

---

## Security Best Practices

1. **Never hardcode mnemonics** - Use environment variables
2. **Validate all inputs** - Check amounts, addresses, slippage
3. **Implement deadlines** - Add transaction expiry
4. **Use minimum output amounts** - Protect against frontrunning
5. **Test thoroughly** - Always test on testnet first
6. **Audit contracts** - Get professional security audit for production
7. **Monitor pools** - Watch for suspicious activity

---

## Useful Links

- **Documentation**: https://docs.keeta.com
- **SDK Docs**: https://static.test.keeta.com/docs/
- **GitHub**: https://github.com/keetanetwork
- **Discord**: https://discord.com/invite/keeta
- **Twitter**: https://twitter.com/KeetaNetwork

---

## Common Token Addresses (Testnet)

```javascript
const COMMON_TOKENS = {
  KEETA: null, // native token
  // Add testnet token addresses as you create them
  USDC: 'keeta_...', // if available
  WETH: 'keeta_...'  // if available
};
```

---

## Helper Functions

### Format Amount for Display

```javascript
function formatAmount(amount, decimals = 8) {
  return (amount / Math.pow(10, decimals)).toFixed(decimals);
}
```

### Parse Amount from Input

```javascript
function parseAmount(amount, decimals = 8) {
  return Math.floor(parseFloat(amount) * Math.pow(10, decimals));
}
```

### Calculate APR for Pool

```javascript
function calculateAPR(feesEarned24h, totalLiquidity) {
  const dailyReturn = feesEarned24h / totalLiquidity;
  const apr = dailyReturn * 365 * 100;
  return apr;
}
```

### Get Optimal Swap Route

```javascript
function findBestRoute(tokenIn, tokenOut, amount, pools) {
  // Direct route
  const directPool = pools.find(p => 
    (p.tokenA === tokenIn && p.tokenB === tokenOut) ||
    (p.tokenA === tokenOut && p.tokenB === tokenIn)
  );
  
  if (directPool) {
    return { path: [tokenIn, tokenOut], pools: [directPool] };
  }
  
  // Multi-hop routes (implement based on your needs)
  // Example: tokenIn -> KEETA -> tokenOut
}
```

---

## Performance Tips

1. **Batch operations** when possible
2. **Cache token metadata** to reduce API calls
3. **Use WebSocket** for real-time updates
4. **Implement retry logic** for failed transactions
5. **Monitor network congestion** and adjust gas accordingly

---

## Troubleshooting

### Issue: Transaction fails silently

**Solution**: Check wallet balance, verify token allowances, ensure correct network

### Issue: Slippage error

**Solution**: Increase slippage tolerance or reduce trade size

### Issue: Can't connect to testnet

**Solution**: Verify endpoint URL, check network connectivity, try alternative RPC

### Issue: Token creation fails

**Solution**: Ensure sufficient KEETA for gas, verify wallet has permissions

---

## Next Steps

1. Start with basic token creation
2. Build simple swap functionality
3. Implement liquidity pools
4. Add frontend UI
5. Test extensively on testnet
6. Consider security audit
7. Deploy to mainnet
