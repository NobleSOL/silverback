# Silverback DEX

A decentralized exchange supporting both **Base** (Ethereum L2) and **Keeta** blockchain networks.

## Features

### 🔄 Token Swaps
- Swap any token pair with competitive rates
- Automatic route optimization through OpenOcean aggregator integration
- Support for native ETH and all ERC20 tokens
- Real-time price quotes and slippage protection

### 💧 Liquidity Pools
- Create new liquidity pools for any token pair
- Add and remove liquidity seamlessly
- Earn fees from swaps in your pools
- Support for both V2 (constant product) AMM pools

### 📊 Portfolio Tracking
- View your token balances across both networks
- Track your liquidity positions
- Monitor swap history and transaction status

### 🌐 Multi-Chain Support
- **Base Mainnet**: Full integration with Ethereum L2
- **Keeta Blockchain**: Native support for Keeta network

### 💰 Fee Structure
- Silverback V2 Pools: 0.30% total fee (0.25% to liquidity providers + 0.05% protocol fee)
- OpenOcean Aggregated Swaps: Competitive routing with best prices

## Getting Started

1. Connect your wallet (MetaMask, WalletConnect, or Keythings)
2. Select the network (Base or Keeta)
3. Start swapping or provide liquidity

## Smart Contracts (Base Mainnet)

- **Factory**: `0x9cd714C51586B52DD56EbD19E3676de65eBf44Ae`
- **Router**: `0x07d00debE946d9183A4dB7756A8A54582c6F205b`
- **Unified Router**: `0x565cBf0F3eAdD873212Db91896e9a548f6D64894`

All contracts are verified on [Basescan](https://basescan.org).

## Technology

- **Frontend**: React + Vite + TypeScript + TailwindCSS
- **Smart Contracts**: Solidity 0.8.20
- **Web3**: wagmi + viem
- **Backend**: Node.js + Express + PostgreSQL

## License

MIT

---

Built with ❤️ by the Silverback team
