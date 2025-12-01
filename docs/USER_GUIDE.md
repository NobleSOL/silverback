# Silverback DEX User Guide

Welcome to Silverback DEX - a dual-network decentralized exchange supporting both **Base** and **Keeta** networks.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Network Selection](#network-selection)
3. [Swapping Tokens](#swapping-tokens)
4. [Managing Liquidity (Pools)](#managing-liquidity-pools)
5. [Creating Anchor Pools (Keeta Only)](#creating-anchor-pools)
6. [Viewing Your Portfolio](#viewing-your-portfolio)
7. [Troubleshooting](#troubleshooting)
8. [FAQ](#faq)

---

## Getting Started

### Prerequisites

#### For Base Network:
- A Web3 wallet (MetaMask, WalletConnect, Coinbase Wallet, etc.)
- ETH on Base network for gas fees
- Tokens you want to trade

#### For Keeta Network:
- **Keythings wallet** browser extension ([Download here](https://keythings.xyz))
- KTA tokens for transaction fees
- Access the DEX at `localhost:3000` (Keythings only works with this URL)

### Connecting Your Wallet

1. Visit the Silverback DEX website
2. Click **"Connect Wallet"** in the top right
3. **Base Network**: Select your preferred wallet provider
4. **Keeta Network**: Keythings will automatically connect if installed

---

## Network Selection

Silverback DEX operates on two separate networks:

### Base Network
- **Features**: Classic (V2) and Concentrated (V3) liquidity pools
- **Aggregation**: Integrated with OpenOcean for best swap rates
- **Use Cases**: Trade popular tokens, leverage deep liquidity

### Keeta Network
- **Features**: AMM pools, FX Anchor trading, user-created anchor pools
- **Advantages**: High-speed transactions (400ms settlement), lower fees
- **Use Cases**: Fast trading, create your own liquidity pools with custom fees

**Switch Networks**: Use the dropdown menu in the top navigation bar.

---

## Swapping Tokens

### Base Network Swaps

1. Navigate to the **Swap** page
2. Select the network: **Base**
3. Choose your input token (what you're selling)
4. Choose your output token (what you're buying)
5. Enter the amount you want to swap
6. Review:
   - **Exchange rate**
   - **Price impact** (how much your trade affects the price)
   - **Slippage tolerance** (click gear icon to adjust, default 0.5%)
7. Click **"Swap"**
8. Approve the transaction in your wallet
9. Wait for confirmation

**Pro Tip**: Silverback automatically finds the best rate across multiple sources including our own pools and OpenOcean aggregator.

### Keeta Network Swaps

#### Option 1: AMM Pool Swaps
1. Navigate to **Swap** page and select **Keeta** network
2. Select tokens and enter amount
3. The app will find the best pool automatically
4. Click **"Swap"** and confirm in Keythings wallet

#### Option 2: FX Anchor Swaps (Recommended - Best Rates)
Silverback pools are now discoverable directly in **Keythings wallet**!

**Via Keythings Wallet:**
1. Open Keythings wallet
2. Go to **Swap** tab
3. Add Silverback resolver: `keeta_asnqu5qxwxq2rhuh77s3iciwhtvra2n7zxviva2ukwqbbxkwxtlqhle5cgcjm`
4. Select your token pair
5. Wallet automatically finds best rate across all providers
6. Confirm swap - executes as atomic SWAP transaction

**Via Silverback UI:**
1. Navigate to **Keeta → Anchor** page
2. Select your token pair
3. Enter swap amount
4. View quotes from all available providers
5. Best rate is automatically selected
6. Click **"Swap"** and confirm

---

## Managing Liquidity (Pools)

### Base Network - Adding Liquidity

1. Navigate to **Pool** page
2. Select **Base** network
3. Choose pool type:
   - **Classic (V2)**: Simple 50/50 pools, great for beginners
   - **Concentrated (V3)**: Advanced, set custom price ranges

#### Adding to Classic Pools:
1. Select two tokens
2. Enter amount for first token (second auto-calculates to maintain ratio)
3. Review pool share you'll receive
4. Click **"Add Liquidity"**
5. Approve both tokens (if first time)
6. Confirm transaction
7. Receive LP tokens representing your pool share

#### Removing Liquidity:
1. Go to **Portfolio** page
2. Find your position under "Classic Positions"
3. Click **"Remove"**
4. Choose percentage to remove (25%, 50%, 75%, 100%)
5. Confirm transaction
6. Receive your tokens back plus earned fees

### Keeta Network - Pool Management

1. Navigate to **Keeta → Pool** page
2. **Create New Pool**:
   - Select two tokens
   - Set initial amounts for both tokens
   - This sets the starting price ratio
   - Click **"Create Pool"**
   - Confirm 3 transactions:
     - Create pool structure
     - Send token A
     - Send token B

3. **Add to Existing Pool**:
   - Select pool from list
   - Enter amounts (maintains current ratio)
   - Confirm transactions

4. **Remove Liquidity**:
   - View your positions
   - Select pool and amount to remove
   - Receive tokens back proportionally

**Earning Fees**: Liquidity providers earn 0.3% on all swaps through their pools.

---

## Creating Anchor Pools

**Keeta Network Only** - Create your own liquidity pool with custom fees to earn from swaps!

### What Are Anchor Pools?

Anchor pools function as FX anchors that compete with other pools for swap volume. Users creating anchor pools can:
- **Set custom fees** (0.01% to 10%)
- **Earn fees** from swaps routed through their pool
- **Compete** with official FX anchors and other user pools

The Anchor page shows all available pools and **automatically routes swaps through the best rate**.

### How to Create an Anchor Pool

1. Navigate to **Keeta → My Anchors** page
2. Connect your Keythings wallet
3. Click **"Create New Anchor Pool"**
4. Fill in details:
   - **Token A**: First token in the pair
   - **Amount A**: How much of token A to deposit
   - **Token B**: Second token in the pair
   - **Amount B**: How much of token B to deposit
   - **Fee (bps)**: Your fee in basis points
     - 30 bps = 0.3% (default, competitive)
     - 10 bps = 0.1% (low fee, attract more volume)
     - 100 bps = 1% (high fee, less competitive)

5. **Review**:
   - Initial price ratio = Amount B / Amount A
   - LP tokens you'll receive = √(Amount A × Amount B)

6. Click **"Create Pool"**

7. **Three-Step Process**:
   - **Step 1**: Backend creates pool account and LP token
   - **Step 2**: You confirm sending token A to pool
   - **Step 3**: You confirm sending token B to pool
   - **Step 4**: Backend mints LP tokens to your wallet

8. **Success!** Your pool is now active and will appear in the Anchor aggregator.

### Managing Your Anchor Pools

From the **My Anchors** page you can:

#### Update Fee
- Click **"Update Fee"** on your pool
- Enter new fee (1-1000 bps)
- Lower fees attract more volume
- Higher fees earn more per swap (but less volume)

#### Pause/Resume Pool
- **Pause**: Temporarily stop accepting swaps (pool stays funded)
- **Resume**: Reactivate pool to start earning again

#### Close Pool
- Permanently close the pool
- Remove all liquidity first

#### View Analytics
Each pool card shows:
- **24h Volume**: Total value swapped through your pool
- **24h Swaps**: Number of trades
- **Fees Collected**: Your earnings
- **Current Reserves**: Pool balances

### Anchor Pool Strategy Tips

**Competitive Fees**:
- Check other pools for same pair
- Slightly lower fee = more volume
- Balance between fee rate and volume

**Balanced Liquidity**:
- Keep reserves roughly balanced
- Prevents your pool from getting skipped

**Monitor Performance**:
- Check analytics daily
- Adjust fees based on volume
- Add more liquidity if volume increases

---

## Viewing Your Portfolio

### Base Network Portfolio

Navigate to **Portfolio** page:

**Classic Positions**:
- View all V2 liquidity positions
- See token amounts and current value
- Add or remove liquidity
- Withdraw earned fees

**Concentrated Positions**:
- View V3 positions with price ranges
- Monitor position health (in/out of range)
- Manage liquidity

### Keeta Network Portfolio

Navigate to **Keeta → My Anchors**:
- View all your anchor pools
- See performance metrics
- Manage pool settings
- Collect fees

---

## Troubleshooting

### Common Issues

#### "Transaction Failed"
**Causes**:
- Insufficient gas/fees
- Slippage tolerance too low
- Token approval needed

**Solutions**:
- Ensure you have enough ETH (Base) or KTA (Keeta) for fees
- Increase slippage tolerance (gear icon)
- Approve token spending first (separate transaction)

#### "Insufficient Liquidity"
**Problem**: Not enough liquidity in pool for your trade size

**Solutions**:
- Reduce swap amount
- Try different token pair with more liquidity
- On Keeta: Use Anchor page to find alternative pools

#### "Price Impact Too High"
**Problem**: Your trade would significantly move the price (>5%)

**Solutions**:
- Reduce trade size
- Split into multiple smaller trades
- Use a pool with deeper liquidity

#### Keythings Wallet Not Connecting
**Solutions**:
- Ensure Keythings extension is installed
- Access DEX at `localhost:3000` (required for Keythings)
- Refresh the page
- Check if wallet is locked

#### Anchor Pool Creation Failed
**Common Causes**:
- Pool already exists for this pair (check My Anchors)
- Insufficient token balance
- Insufficient KTA for fees

**Solutions**:
- Verify you have enough of both tokens
- Ensure 3-5 KTA for transaction fees
- Check you don't already have a pool for this pair

#### LP Token Minting Failed
**Problem**: Pool created but LP tokens not received

**Contact Support**: This requires manual intervention

---

## FAQ

### General Questions

**Q: What is Silverback DEX?**
A: A dual-network DEX supporting Base (EVM) and Keeta (high-speed blockchain) with AMM pools and FX anchor trading.

**Q: Which network should I use?**
A:
- **Base**: For popular tokens, deep liquidity, integration with Ethereum ecosystem
- **Keeta**: For fast trades, lower fees, creating custom liquidity pools

**Q: Are there trading fees?**
A:
- **Swap fees**: 0.3% on AMM swaps (goes to liquidity providers)
- **Anchor pool creator fee**: Variable (0.01% - 10% depending on pool)
- **Protocol fee**: 0.05% on all FX anchor swaps (collected by Silverback)
- **Gas fees**: Paid in ETH (Base) or KTA (Keeta)

### Liquidity & Pools

**Q: What are LP tokens?**
A: LP (Liquidity Provider) tokens represent your share of a liquidity pool. Hold them to earn fees, redeem them to withdraw liquidity.

**Q: How do I earn fees as a liquidity provider?**
A: Fees are automatically earned when traders swap through your pool. They're added to the pool and you receive them when you withdraw liquidity.

**Q: What is impermanent loss?**
A: A temporary loss that occurs when token prices diverge. If you withdraw when prices have changed significantly from when you deposited, you may have less value than if you just held the tokens.

**Q: Can I remove liquidity anytime?**
A: Yes! Liquidity is not locked. Remove anytime and receive tokens proportional to your pool share.

### Anchor Pools (Keeta)

**Q: What's the difference between AMM pools and Anchor pools?**
A:
- **AMM Pools**: Traditional constant-product pools (x*y=k), fixed 0.3% fee
- **Anchor Pools**: Compete in FX anchor aggregator, custom fees (0.01%-10%)

**Q: How do I make money with anchor pools?**
A: Earn fees when swaps are routed through your pool. The Anchor page automatically selects the best rate, so competitive fees attract more volume.

**Q: Can I have multiple anchor pools?**
A: Yes! Create one pool per token pair. You can't have two pools for the same pair (e.g., two KTA/USDC pools).

**Q: What fee should I set?**
A: Check existing pools for your pair. Setting a fee 10-50 bps lower than competitors often increases your volume significantly.

**Q: Can someone else provide liquidity to my anchor pool?**
A: Not currently. Each user creates and manages their own pools.

### Security & Safety

**Q: Is Silverback DEX safe?**
A: The smart contracts follow Uniswap V2 standards (battle-tested). However, always:
- Never invest more than you can afford to lose
- Understand impermanent loss before providing liquidity
- Verify token addresses before trading

**Q: Does Silverback custody my funds?**
A: No! This is a non-custodial DEX. You retain full control of your wallet and tokens.

**Q: What if I lose my LP tokens?**
A: Treat LP tokens like any crypto asset. Losing them means losing access to your liquidity. Back up your wallet recovery phrase!

### Technical

**Q: Why does Keeta require localhost:3000?**
A: Keythings wallet extension only works with allowlisted URLs. Localhost:3000 is on the allowlist for development/testing.

**Q: What is slippage tolerance?**
A: The maximum price change you'll accept. If price moves more than your tolerance between when you submit and when transaction executes, it will fail.

**Q: Why do I need to approve tokens?**
A: ERC-20 tokens require you to grant permission for smart contracts to spend them. This is a one-time transaction per token per contract.

---

## Need More Help?

- **Discord**: [Join our community](#)
- **Twitter**: [@SilverbackDEX](#)
- **Email**: support@silverbackdex.com
- **GitHub**: [Report issues](https://github.com/NobleSOL/silverback/issues)

---

## Quick Links

- [Keythings Wallet](https://keythings.xyz)
- [Base Network Info](https://base.org)
- [Keeta Network Docs](https://docs.keeta.com)
- [Smart Contract Addresses](/contracts)

---

**Happy Trading! 🚀**

*Last Updated: November 2025*
