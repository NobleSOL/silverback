# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Silverback DEX is a production-ready decentralized exchange with:
- **Frontend**: React 18 + Vite + TypeScript + TailwindCSS 3 + wagmi
- **Smart Contracts**: Solidity 0.8.20 Uniswap V2-style AMM with custom router
- **Backend**: Express server integrated with Vite dev server (minimal endpoints)

The project combines a custom Silverback AMM (V2-style constant product) with OpenOcean aggregator integration for optimal swap routing.

## Development Commands

### Frontend & Server
```bash
pnpm dev                    # Start dev server (client + server on port 8080)
pnpm build                  # Production build (client + server)
pnpm build:client           # Build frontend only
pnpm build:server           # Build backend only
pnpm start                  # Start production server
pnpm typecheck              # TypeScript validation
pnpm test                   # Run Vitest tests
```

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
├── pages/              # Route components
│   ├── Index.tsx       # Swap interface (home page)
│   ├── Pool.tsx        # Liquidity management
│   └── Portfolio.tsx   # User holdings
├── components/
│   ├── swap/           # Swap-specific components
│   ├── shared/         # Reusable components (slippage, token selector)
│   ├── wallet/         # Wallet connection
│   └── ui/             # Radix UI component library
├── amm/
│   ├── config.ts       # Contract addresses and environment vars
│   ├── v2.ts           # V2 AMM interaction logic
│   └── v3.ts           # V3 pool support (via existing NFPM)
├── aggregator/         # OpenOcean integration
├── wallet/             # wagmi configuration
└── App.tsx             # React Router setup
```

**Environment variables** (`.env`):
```
VITE_SB_V2_FACTORY=<deployed factory address>
VITE_SB_V2_ROUTER=<deployed router address>
VITE_V3_NFPM=<NonfungiblePositionManager address>
VITE_BASE_RPC_URL=https://mainnet.base.org
VITE_WALLETCONNECT_PROJECT_ID=<project id>
```

### Backend (`/server`)

Minimal Express server. Only create new endpoints when strictly necessary (private key handling, database operations, etc.).

```
server/
├── index.ts       # Express setup and route registration
└── routes/        # API handlers (prefixed with /api/)
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

## Important Notes

- This is a hybrid DEX: uses Silverback V2 AMM for owned liquidity + OpenOcean for aggregated routing
- Path aliases: `@/*` → `client/`, `@shared/*` → `shared/`
- Single-port development (8080) with Vite HMR for both client and server
- Package manager: **pnpm** (specified in package.json)
- The project uses React Router 6 in SPA mode (not file-based routing)
