// src/server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { getOpsClient } from './utils/client.js';
import { getPoolManager } from './contracts/PoolManager.js';
import { CONFIG } from './utils/constants.js';

// Import routes
import swapRoutes from './routes/swap.js';
import liquidityRoutes from './routes/liquidity.js';
import poolsRoutes from './routes/pools.js';
import transactionsRoutes from './routes/transactions.js';
import walletRoutes from './routes/wallet.js';
import chartsRoutes from './routes/charts.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();

// Middleware
app.use(cors({
  origin: CONFIG.CORS_ORIGINS,
  credentials: true,
}));
app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check
app.get('/ping', async (req, res) => {
  const t0 = Date.now();
  try {
    const client = await getOpsClient();
    const t1 = Date.now();
    res.json({
      ok: true,
      network: CONFIG.NETWORK,
      connectMs: t1 - t0,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e.message,
    });
  }
});

// API info
app.get('/api/info', async (req, res) => {
  try {
    const poolManager = await getPoolManager();
    const pools = poolManager.getAllPools();

    res.json({
      name: 'Silverback DEX',
      version: '1.0.0',
      network: CONFIG.NETWORK,
      swapFeeBps: CONFIG.SWAP_FEE_BPS,
      totalPools: pools.length,
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

// Mount routes
app.use('/api/wallet', walletRoutes);
app.use('/api/swap', swapRoutes);
app.use('/api/liquidity', liquidityRoutes);
app.use('/api/pools', poolsRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/charts', chartsRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error',
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
  });
});

// Initialize and start server
async function start() {
  try {
    console.log('🚀 Starting Silverback DEX Backend...');
    console.log(`📡 Network: ${CONFIG.NETWORK}`);
    
    // Initialize Keeta client
    await getOpsClient();
    
    // Initialize pool manager
    await getPoolManager();
    
    // Start server
    const port = CONFIG.PORT;
    app.listen(port, () => {
      console.log(`✅ Server running on port ${port}`);
      console.log(`🔗 API: http://localhost:${port}/api`);
      console.log(`💓 Health: http://localhost:${port}/ping`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

start();
