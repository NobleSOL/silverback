// server/keeta-routes.ts
// Keeta DEX API routes - integrates with Keeta Network blockchain
import { Router } from 'express';

// Import route modules from keeta-impl
import swapRouter from './keeta-impl/routes/swap.js';
import swapKeythingsRouter from './keeta-impl/routes/swap-keythings.js';
import liquidityRouter from './keeta-impl/routes/liquidity.js';
import liquidityKeythingsRouter from './keeta-impl/routes/liquidity-keythings.js';
import poolsRouter from './keeta-impl/routes/pools.js';
import anchorPoolsRouter from './keeta-impl/routes/anchor-pools.js';
import anchorRouter from './keeta-impl/routes/anchor.js';
import walletRouter from './keeta-impl/routes/wallet.js';
import transactionsRouter from './keeta-impl/routes/transactions.js';
import adminRouter from './keeta-impl/routes/admin.js';
import pricingRouter from './keeta-impl/routes/pricing.js';
import transferRouter from './keeta-impl/routes/transfer.js';

const router = Router();

// Mount Keeta routes under /api prefix
router.use('/api/swap', swapRouter);
router.use('/api/swap/keythings', swapKeythingsRouter);
router.use('/api/liquidity', liquidityRouter);
router.use('/api/liquidity/keythings', liquidityKeythingsRouter);
router.use('/api/pools', poolsRouter);
router.use('/api/anchor-pools', anchorPoolsRouter);
router.use('/api/anchor', anchorRouter);
router.use('/api/wallet', walletRouter);
router.use('/api/transactions', transactionsRouter);
router.use('/api/admin', adminRouter);
router.use('/api/pricing', pricingRouter);
router.use('/api/transfer', transferRouter);

export default router;
