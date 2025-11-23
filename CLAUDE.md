# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Silverback DEX is a **dual-network decentralized exchange** supporting both Base and Keeta networks:

### Base Network
- **Frontend**: React 18 + Vite + TypeScript + TailwindCSS 3 + wagmi
- **Smart Contracts**: Solidity 0.8.20 Uniswap V2-style AMM with custom router
- **Features**: Classic (V2) and Concentrated (V3) liquidity pools + OpenOcean aggregation

### Keeta Network
- **Frontend**: React 18 + Vite + TypeScript + TailwindCSS 3
- **SDK**: @keetanetwork/keetanet-client + @keetanetwork/anchor
- **Features**: Pool-based AMM + FX Anchor trading aggregation
- **Wallet**: Keythings browser extension integration
- **Backend**: Express server with Keeta blockchain APIs

**Strategic Position**: The platform serves as both a liquidity provider (via pools/anchor) and a trading aggregator (showing best rates across all providers).

## Development Commands

### Frontend & Server
```bash
pnpm dev                    # Start dev server (client + server on port 3000)
pnpm build                  # Production build (client + server)
pnpm build:client           # Build frontend only
pnpm build:server           # Build backend only
pnpm start                  # Start production server
pnpm typecheck              # TypeScript validation
pnpm test                   # Run Vitest tests
```

**Note**: Port 3000 is required for Keythings wallet compatibility (localhost:3000 is allowlisted)

### Smart Contracts (Hardhat)
```bash
pnpm hh:compile             # Compile Solidity contracts
pnpm deploy:v2:sepolia      # Deploy V2 contracts to Base Sepolia
pnpm verify:v2:sepolia      # Verify contracts on Basescan
```

### Manual Hardhat Operations
```bash
# Compile contracts
npx hardhat compile

# Run tests
npx hardhat test

# Deploy router manually
node scripts/deploy-silverback-router.ts https://mainnet.base.org <PRIVATE_KEY> 30

# Run specific test file
npx hardhat test test/silverback-router.test.js
```

## Architecture

### Smart Contracts (`/contracts`)

The core AMM consists of three main contracts:

1. **SilverbackFactory.sol** - Deploys pair contracts using CREATE2
   - `createPair(tokenA, tokenB)` - Creates new liquidity pool
   - `getPair(token0, token1)` - Retrieves pair address
   - Fee management via `feeTo` and `feeToSetter`

2. **SilverbackPair.sol** - Constant product AMM pool (x * y = k)
   - Standard Uniswap V2-style pair contract
   - 0.3% swap fee to liquidity providers
   - ERC20 LP tokens for liquidity positions

3. **SilverbackRouter.sol** - User-facing swap and liquidity interface
   - `addLiquidity()` / `addLiquidityETH()` - Add liquidity to pools
   - `removeLiquidity()` / `removeLiquidityETH()` - Remove liquidity
   - `swapExactTokensForTokens()` - Execute token swaps
   - `swapTokensForExactTokens()` - Execute swaps with exact output
   - Supports native ETH via WETH wrapping

**Key addresses (Base Mainnet):**
- WETH: `0x4200000000000000000000000000000000000006`
- Silverback Router: `0x4752Ba5DbC23F44d87826276Bf6fD6B1c372AD24`

### Frontend (`/client`)

```
client/
├── pages/              # Base DEX pages
│   ├── Index.tsx       # Swap interface (Base)
│   ├── Pool.tsx        # Liquidity management (Base)
│   └── Portfolio.tsx   # Classic + Concentrated positions (Base)
├── pages/keeta/        # Keeta DEX pages
│   ├── Index.tsx       # Pool-based swap (Keeta)
│   ├── Pool.tsx        # Create/manage pools (Keeta)
│   └── Anchor.tsx      # FX Anchor trading aggregator (Keeta)
├── components/
│   ├── swap/           # Swap-specific components
│   ├── shared/         # Reusable components (slippage, token selector, QuickFill)
│   ├── wallet/         # Wallet connection (wagmi for Base)
│   ├── keeta/          # Keeta-specific components
│   └── ui/             # Radix UI component library
├── contexts/
│   ├── NetworkContext.tsx      # Base/Keeta network switching
│   └── KeetaWalletContext.tsx  # Keeta wallet state management
├── lib/
│   ├── keeta-client.ts         # Keeta blockchain client utilities
│   ├── keeta-anchor.ts         # FX Anchor SDK integration
│   └── keythings-provider.ts   # Keythings wallet integration
├── amm/
│   ├── config.ts       # Contract addresses and environment vars (Base)
│   ├── v2.ts           # V2 AMM interaction logic (Base)
│   └── v3.ts           # V3 pool support via NFPM (Base)
├── aggregator/         # OpenOcean integration (Base)
├── wallet/             # wagmi configuration (Base)
└── App.tsx             # Network-aware routing
```

**Environment variables** (`.env`):
```
# Base Network
VITE_SB_V2_FACTORY=<deployed factory address>
VITE_SB_V2_ROUTER=<deployed router address>
VITE_V3_NFPM=<NonfungiblePositionManager address>
VITE_BASE_RPC_URL=https://mainnet.base.org
VITE_WALLETCONNECT_PROJECT_ID=<project id>

# Keeta Network
VITE_KEETA_API_BASE=<backend URL for Keeta APIs>
```

### Backend (`/server`)

Express server providing Keeta blockchain APIs. Base network operations are handled client-side via wagmi.

```
server/
├── index.ts                # Express setup and route registration
├── keeta-impl/
│   ├── routes/
│   │   ├── pools.js        # Pool creation, liquidity, swap
│   │   ├── pricing.js      # Token price data
│   │   └── transfer.js     # Token transfers
│   └── utils/
│       ├── client.js       # Keeta client utilities
│       ├── constants.js    # Network constants
│       └── anchor.js       # FX Anchor placeholders (future)
└── routes/                 # Additional API handlers
```

## Key Development Patterns

### Adding a New Route (Frontend)
1. Create component in `client/pages/MyPage.tsx`
2. Register in `client/App.tsx`:
   ```typescript
   <Route path="/my-page" element={<MyPage />} />
   ```

### Smart Contract Development
- Solidity version: `0.8.20`
- Optimizer enabled: 200 runs
- Use `SilverbackLibrary.sol` for AMM math helpers
- All contracts import interfaces from `contracts/interfaces.sol`

### Styling
- Primary: TailwindCSS 3 utility classes
- Theme config: `client/global.css` and `tailwind.config.ts`
- Component library: Radix UI in `client/components/ui/`
- Use `cn()` utility (clsx + tailwind-merge) for conditional classes

### Swap Flow Integration
1. Frontend fetches quote from OpenOcean API
2. User approves token to Silverback Router
3. Call `swapExactTokensForTokens()` with path and amounts
4. Router executes swap through Silverback pairs or forwards to aggregator
5. Output tokens swept to user

## Testing

- Test files in `/test` directory
- Example: `test/silverback-router.test.js` tests router swap functionality
- Use Hardhat's built-in testing framework with Mocha/Chai

## Deployment

Contracts deployed to Base Sepolia testnet (chainId: 84532). Deployment scripts in `/scripts`:
- `deploy-silverback-factory.ts` - Deploy factory
- `deploy-silverback-router.ts` - Deploy router
- `verify-router.ts` - Verify on Basescan

Frontend deployable to Netlify (config in `netlify.toml`).

## Network Architecture

### Base DEX (EVM)
- **Swap Page**: Classic (V2) and Concentrated (V3) pools + OpenOcean aggregation
- **Pool Page**: Add/remove liquidity to pools
- **Positions Page**: View Classic and Concentrated positions
- **Wallet**: wagmi + viem for EVM interaction

### Keeta DEX (Keeta Blockchain)
- **Swap Page**: Pool-based AMM swaps (Uniswap V2 style)
- **Pool Page**: Create pools, add/remove liquidity
- **Anchor Page**: FX Anchor trading aggregator (queries ALL anchor providers)
- **Wallet**: Keythings browser extension (localhost:3000 required)
- **Backend**: Express APIs for pool creation, swaps, transfers

## FX Anchor Integration

The Anchor page (`/pages/keeta/Anchor.tsx`) implements a **trading aggregator** using the `@keetanetwork/anchor` SDK:

### How It Works
1. User selects tokens and amount
2. Client queries ALL registered FX anchor providers on Keeta network
3. Displays best quote across all providers
4. Executes atomic swap through selected anchor

### Strategic Value
- **Aggregator Platform**: Show users best rates across all Keeta anchors
- **Future Liquidity Provider**: When BACK token launches, run own anchor
- **Fee Income**: Earn from both aggregation volume + anchor swaps

### Key Files
- `client/lib/keeta-anchor.ts` - FX Anchor SDK integration
- `client/pages/keeta/Anchor.tsx` - Trading UI
- `server/keeta-impl/utils/anchor.js` - Server-side anchor placeholders

**Status**: UI ready, awaiting anchor providers on mainnet. Currently on testnet (`api.test.keeta.com`).

## Important Notes

- **Dual-network DEX**: Base (EVM) + Keeta (custom blockchain)
- **Network switching**: Header dropdown toggles between Base/Keeta, changes all pages
- **Design system**: Glass-morphism cards, monochrome theme, consistent across networks
- Path aliases: `@/*` → `client/`, `@shared/*` → `shared/`
- **Development port**: 3000 (required for Keythings wallet allowlist)
- Single-port development with Vite HMR for both client and server
- Package manager: **pnpm** (specified in package.json)
- React Router 6 in SPA mode (not file-based routing)
