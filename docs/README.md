# Silverback DEX Documentation Hub

Welcome to the Silverback DEX documentation center. Find everything you need to use, build, or integrate with Silverback DEX.

---

## 📚 Documentation Categories

### 🎯 For Users

**[User Guide](./USER_GUIDE.md)** - Complete guide for trading and providing liquidity
- Getting started & wallet setup
- How to swap tokens on Base and Keeta
- Managing liquidity pools
- Creating and managing anchor pools
- Troubleshooting common issues
- Comprehensive FAQ

**Perfect for**: First-time users, traders, liquidity providers

---

### 👨‍💻 For Developers

**[Keeta DEX Development Guide](./keeta-dex-guide.md)** - Build on Keeta Network
- Keeta Network architecture and technology
- Creating tokens and liquidity pairs
- Implementing DEX functionality
- Smart contract patterns
- Testnet resources

**[Keeta Quick Reference](./keeta-quick-reference.md)** - Fast lookup for common patterns
- Essential commands and code snippets
- Token operations (create, transfer, mint, burn)
- Swap and liquidity formulas
- Anchor pool API reference
- Network information

**Perfect for**: Developers building on Keeta Network, integrating with Silverback

---

### 🏗️ For Contributors

**[CLAUDE.md](../CLAUDE.md)** - Project architecture and development guide
- Complete project structure
- Development commands (frontend, server, contracts)
- Smart contract architecture
- Frontend component organization
- Backend API endpoints
- Key development patterns

**Perfect for**: Contributors, maintainers, AI assistants

---

## 🚀 Quick Start Guides

### I want to trade tokens
→ **[User Guide - Swapping Tokens](./USER_GUIDE.md#swapping-tokens)**

### I want to provide liquidity and earn fees
→ **[User Guide - Managing Liquidity](./USER_GUIDE.md#managing-liquidity-pools)**

### I want to create my own anchor pool
→ **[User Guide - Creating Anchor Pools](./USER_GUIDE.md#creating-anchor-pools)**

### I'm having issues with the DEX
→ **[User Guide - Troubleshooting](./USER_GUIDE.md#troubleshooting)**

### I want to build on Keeta Network
→ **[Keeta DEX Development Guide](./keeta-dex-guide.md)**

### I need quick code examples
→ **[Keeta Quick Reference](./keeta-quick-reference.md)**

---

## 🌐 Network Information

### Base Network (EVM)
- **Chain ID**: 8453 (Mainnet), 84532 (Sepolia Testnet)
- **RPC**: https://mainnet.base.org
- **Explorer**: https://basescan.org
- **WETH**: `0x4200000000000000000000000000000000000006`
- **Silverback Router**: `0x4752Ba5DbC23F44d87826276Bf6fD6B1c372AD24`

### Keeta Network
- **Mainnet RPC**: https://api.keeta.com
- **Testnet RPC**: https://api.test.keeta.com
- **Explorer**: https://explorer.keeta.com
- **Wallet**: [Keythings](https://keythings.xyz) (Chrome Web Store)

---

## 📖 Key Concepts

### Automated Market Maker (AMM)
Silverback uses constant product formula (x * y = k) for Base network pools and Keeta AMM pools. Users trade against liquidity pools instead of order books.

### Anchor Pools (Keeta Only)
User-created liquidity pools that compete as FX anchors with customizable fees (0.01% - 10%). The Anchor aggregator automatically routes swaps through the best rate.

### Liquidity Provider (LP) Tokens
Represent your share of a liquidity pool. Earn trading fees proportional to your share. Redeem anytime to withdraw liquidity.

### Price Impact
How much your trade moves the market price. Larger trades in smaller pools = higher impact.

### Slippage Tolerance
Maximum price change you'll accept between submitting and executing a trade.

### Impermanent Loss
Potential loss from price divergence when providing liquidity vs. holding tokens.

---

## 🔗 Important Links

- **Website**: [silverbackdex.com](#)
- **Discord**: [Join Community](#)
- **Twitter**: [@SilverbackDEX](#)
- **GitHub**: [Source Code](https://github.com/NobleSOL/silverback)
- **Email**: support@silverbackdex.com

### External Resources
- [Base Network Documentation](https://docs.base.org)
- [Keeta Network Documentation](https://docs.keeta.com)
- [Keythings Wallet](https://keythings.xyz)
- [Uniswap V2 Documentation](https://docs.uniswap.org/contracts/v2/overview) (our Base AMM is based on this)

---

## 🛟 Support

### Having Issues?

1. **Check the FAQ**: [User Guide - FAQ](./USER_GUIDE.md#faq)
2. **Troubleshooting Guide**: [User Guide - Troubleshooting](./USER_GUIDE.md#troubleshooting)
3. **Ask the Community**: Join our Discord
4. **Report Bugs**: [GitHub Issues](https://github.com/NobleSOL/silverback/issues)

### Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| Transaction failed | Check gas fees, increase slippage tolerance |
| Keythings not connecting | Install from Chrome Web Store, refresh page |
| Can't create anchor pool | Verify token balances, check for duplicate pairs |
| Tokens not showing | Add token address manually to wallet |
| Swap quote not loading | Check network connection, refresh page |

---

## 📊 Platform Stats

- **Networks Supported**: 2 (Base + Keeta)
- **Pool Types**: Classic AMM, Concentrated Liquidity, User Anchor Pools
- **Aggregation**: OpenOcean (Base), FX Anchor + Silverback (Keeta)
- **Governance**: Community-driven
- **License**: MIT

---

## 🏗️ Contributing

We welcome contributions! Whether it's:
- Bug reports and feature requests
- Documentation improvements
- Code contributions
- Community support

Check out our [GitHub repository](https://github.com/NobleSOL/silverback) to get started.

---

## 📝 Documentation Updates

This documentation is actively maintained. Last major update: November 2025

Found an error or want to suggest improvements?
- Open an issue: [GitHub Issues](https://github.com/NobleSOL/silverback/issues)
- Submit a PR: [GitHub Pull Requests](https://github.com/NobleSOL/silverback/pulls)

---

## 🎓 Learning Path

### New User Path
1. [Getting Started](./USER_GUIDE.md#getting-started) - Set up wallet
2. [Swapping Tokens](./USER_GUIDE.md#swapping-tokens) - Make your first trade
3. [Adding Liquidity](./USER_GUIDE.md#managing-liquidity-pools) - Start earning fees
4. [Creating Anchor Pools](./USER_GUIDE.md#creating-anchor-pools) - Advanced earning

### Developer Path
1. [Keeta Network Overview](./keeta-dex-guide.md#overview) - Understand the platform
2. [Development Setup](./keeta-dex-guide.md#setup) - Configure environment
3. [Creating Tokens](./keeta-dex-guide.md#creating-tokens) - Token fundamentals
4. [DEX Implementation](./keeta-dex-guide.md#dex-implementation) - Build your DEX

---

**Ready to start? Pick a guide above and dive in! 🚀**
