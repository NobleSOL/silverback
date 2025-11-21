// src/server-base-compatible.js
/**
 * Silverback DEX - Keeta Backend (Base-Compatible API)
 * 
 * This backend mimics the SilverbackRouter contract interface
 * so the frontend can seamlessly switch between Base and Keeta
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { getOpsClient, getTreasuryAccount, getOpsAccount } from './utils/client.js';
import { getPoolManager } from './contracts/PoolManager.js';
import { CONFIG } from './utils/constants.js';

dotenv.config();

const app = express();

// Middleware
app.use(cors({
  origin: CONFIG.CORS_ORIGINS,
  credentials: true,
}));
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// ============================================================================
// BASE-COMPATIBLE ENDPOINTS (Match your existing DEX)
// ============================================================================

/**
 * GET /api/chain
 * Return chain info (similar to how Base DEX detects chain)
 */
app.get('/api/chain', (req, res) => {
  res.json({
    chainId: 'keeta-testnet', // or 'keeta-mainnet'
    chainName: 'Keeta Network',
    network: CONFIG.NETWORK,
    rpcUrl: CONFIG.NODE_HTTP,
    nativeCurrency: {
      name: 'KTA',
      symbol: 'KTA',
      decimals: 9,
    },
    blockExplorer: `https://explorer.${CONFIG.NETWORK}.keeta.com`,
  });
});

/**
 * GET /api/config
 * DEX configuration (matches your env vars structure)
 */
app.get('/api/config', async (req, res) => {
  try {
    const poolManager = await getPoolManager();
    const pools = poolManager.getAllPools();

    res.json({
      // Router config (equivalent to SilverbackRouter)
      feeRecipient: getTreasuryAccount().publicKeyString.get(),
      feeBps: CONFIG.SWAP_FEE_BPS,
      
      // Factory/Router addresses (Keeta pool manager)
      poolManager: 'keeta-pool-manager', // Virtual address
      
      // Available pools
      pools: pools.map(p => ({
        address: p.poolAddress,
        tokenA: p.tokenA,
        tokenB: p.tokenB,
      })),
      
      // Network info
      network: CONFIG.NETWORK,
      weth: CONFIG.BASE_TOKEN, // KTA acts as WETH equivalent
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/quote
 * Get swap quote (replaces OpenOcean quote call)
 * 
 * Body matches OpenOcean format:
 * {
 *   inTokenAddress: string,
 *   outTokenAddress: string,
 *   amount: string (human-readable),
 *   gasPrice?: string
 * }
 */
app.post('/api/quote', async (req, res) => {
  try {
    const { inTokenAddress, outTokenAddress, amount, slippage = 0.5 } = req.body;

    if (!inTokenAddress || !outTokenAddress || !amount) {
      return res.status(400).json({
        code: 400,
        message: 'Missing required parameters',
      });
    }

    const poolManager = await getPoolManager();
    const { fetchTokenDecimals } = await import('./utils/client.js');
    const { toAtomic, fromAtomic } = await import('./utils/constants.js');

    // Convert amount to atomic
    const decimalsIn = await fetchTokenDecimals(inTokenAddress);
    const amountInAtomic = toAtomic(Number(amount), decimalsIn);

    // Get quote from pool
    const quote = await poolManager.getSwapQuote(
      inTokenAddress,
      outTokenAddress,
      amountInAtomic
    );

    const decimalsOut = await fetchTokenDecimals(outTokenAddress);

    // Format response to match OpenOcean structure
    res.json({
      code: 200,
      data: {
        inToken: {
          address: inTokenAddress,
          symbol: 'TOKEN', // TODO: Get from metadata
          decimals: decimalsIn,
        },
        outToken: {
          address: outTokenAddress,
          symbol: 'TOKEN', // TODO: Get from metadata
          decimals: decimalsOut,
        },
        inAmount: quote.amountIn,
        outAmount: quote.amountOut,
        minOutAmount: quote.minAmountOut,
        price: quote.amountOutHuman / quote.amountInHuman,
        priceImpact: quote.priceImpact,
        estimatedGas: '100000', // Keeta gas estimation
        path: [inTokenAddress, outTokenAddress], // Direct swap
        
        // Keeta-specific
        fee: quote.feeAmount,
        feePercent: (CONFIG.SWAP_FEE_BPS / 100).toString(),
      },
    });
  } catch (error) {
    console.error('Quote error:', error);
    res.status(500).json({
      code: 500,
      message: error.message,
    });
  }
});

/**
 * POST /api/swap
 * Execute swap (replaces contract call to SilverbackRouter.swapAndForward)
 * 
 * Body format (matches your contract params):
 * {
 *   userAddress: string,
 *   inToken: string,
 *   outToken: string,
 *   amountIn: string (human-readable),
 *   minAmountOut: string (human-readable),
 *   deadline?: number
 * }
 */
app.post('/api/swap', async (req, res) => {
  try {
    const {
      userAddress,
      inToken,
      outToken,
      amountIn,
      minAmountOut = '0',
      deadline,
    } = req.body;

    if (!userAddress || !inToken || !outToken || !amountIn) {
      return res.status(400).json({
        code: 400,
        message: 'Missing required parameters',
      });
    }

    // Check deadline
    if (deadline && Date.now() / 1000 > deadline) {
      return res.status(400).json({
        code: 400,
        message: 'Transaction expired',
      });
    }

    const poolManager = await getPoolManager();
    const { fetchTokenDecimals } = await import('./utils/client.js');
    const { toAtomic } = await import('./utils/constants.js');

    // Convert amounts to atomic
    const decimalsIn = await fetchTokenDecimals(inToken);
    const decimalsOut = await fetchTokenDecimals(outToken);
    const amountInAtomic = toAtomic(Number(amountIn), decimalsIn);
    const minAmountOutAtomic = toAtomic(Number(minAmountOut), decimalsOut);

    // Execute swap
    const result = await poolManager.swap(
      userAddress,
      inToken,
      outToken,
      amountInAtomic,
      minAmountOutAtomic
    );

    // Format response
    res.json({
      code: 200,
      data: {
        success: true,
        hash: 'keeta-tx-hash', // TODO: Get actual tx hash from Keeta
        amountOut: result.amountOut.toString(),
        amountOutHuman: result.amountOut / BigInt(10 ** decimalsOut),
        feeAmount: result.feeAmount.toString(),
        priceImpact: result.priceImpact,
      },
    });
  } catch (error) {
    console.error('Swap error:', error);
    res.status(500).json({
      code: 500,
      message: error.message,
    });
  }
});

/**
 * POST /api/liquidity/add
 * Add liquidity (matches V2Router.addLiquidity)
 */
app.post('/api/liquidity/add', async (req, res) => {
  try {
    const {
      userAddress,
      tokenA,
      tokenB,
      amountADesired,
      amountBDesired,
      amountAMin = '0',
      amountBMin = '0',
      deadline,
    } = req.body;

    if (!userAddress || !tokenA || !tokenB || !amountADesired || !amountBDesired) {
      return res.status(400).json({
        code: 400,
        message: 'Missing required parameters',
      });
    }

    if (deadline && Date.now() / 1000 > deadline) {
      return res.status(400).json({
        code: 400,
        message: 'Transaction expired',
      });
    }

    const poolManager = await getPoolManager();
    const { fetchTokenDecimals } = await import('./utils/client.js');
    const { toAtomic } = await import('./utils/constants.js');

    const decimalsA = await fetchTokenDecimals(tokenA);
    const decimalsB = await fetchTokenDecimals(tokenB);

    const amountADesiredAtomic = toAtomic(Number(amountADesired), decimalsA);
    const amountBDesiredAtomic = toAtomic(Number(amountBDesired), decimalsB);
    const amountAMinAtomic = toAtomic(Number(amountAMin), decimalsA);
    const amountBMinAtomic = toAtomic(Number(amountBMin), decimalsB);

    const result = await poolManager.addLiquidity(
      userAddress,
      tokenA,
      tokenB,
      amountADesiredAtomic,
      amountBDesiredAtomic,
      amountAMinAtomic,
      amountBMinAtomic
    );

    res.json({
      code: 200,
      data: {
        success: true,
        hash: 'keeta-tx-hash',
        amountA: result.amountA.toString(),
        amountB: result.amountB.toString(),
        liquidity: result.liquidity.toString(),
      },
    });
  } catch (error) {
    console.error('Add liquidity error:', error);
    res.status(500).json({
      code: 500,
      message: error.message,
    });
  }
});

/**
 * POST /api/liquidity/remove
 * Remove liquidity (matches V2Router.removeLiquidity)
 */
app.post('/api/liquidity/remove', async (req, res) => {
  try {
    const {
      userAddress,
      tokenA,
      tokenB,
      liquidity,
      amountAMin = '0',
      amountBMin = '0',
      deadline,
    } = req.body;

    if (!userAddress || !tokenA || !tokenB || !liquidity) {
      return res.status(400).json({
        code: 400,
        message: 'Missing required parameters',
      });
    }

    if (deadline && Date.now() / 1000 > deadline) {
      return res.status(400).json({
        code: 400,
        message: 'Transaction expired',
      });
    }

    const poolManager = await getPoolManager();
    const { fetchTokenDecimals } = await import('./utils/client.js');
    const { toAtomic } = await import('./utils/constants.js');

    const decimalsA = await fetchTokenDecimals(tokenA);
    const decimalsB = await fetchTokenDecimals(tokenB);
    const liquidityAtomic = BigInt(liquidity);
    const amountAMinAtomic = toAtomic(Number(amountAMin), decimalsA);
    const amountBMinAtomic = toAtomic(Number(amountBMin), decimalsB);

    const result = await poolManager.removeLiquidity(
      userAddress,
      tokenA,
      tokenB,
      liquidityAtomic,
      amountAMinAtomic,
      amountBMinAtomic
    );

    res.json({
      code: 200,
      data: {
        success: true,
        hash: 'keeta-tx-hash',
        amountA: result.amountA.toString(),
        amountB: result.amountB.toString(),
      },
    });
  } catch (error) {
    console.error('Remove liquidity error:', error);
    res.status(500).json({
      code: 500,
      message: error.message,
    });
  }
});

/**
 * POST /api/pool/create
 * Create new pool (matches Factory.createPair)
 */
app.post('/api/pool/create', async (req, res) => {
  try {
    const { tokenA, tokenB } = req.body;

    if (!tokenA || !tokenB) {
      return res.status(400).json({
        code: 400,
        message: 'Missing required parameters',
      });
    }

    if (tokenA === tokenB) {
      return res.status(400).json({
        code: 400,
        message: 'Identical addresses',
      });
    }

    const poolManager = await getPoolManager();

    if (poolManager.hasPool(tokenA, tokenB)) {
      return res.status(409).json({
        code: 409,
        message: 'Pool already exists',
      });
    }

    const pool = await poolManager.createPool(tokenA, tokenB);
    const info = await pool.getPoolInfo();

    res.json({
      code: 200,
      data: {
        success: true,
        pair: info.poolAddress,
        tokenA: info.tokenA,
        tokenB: info.tokenB,
      },
    });
  } catch (error) {
    console.error('Create pool error:', error);
    res.status(500).json({
      code: 500,
      message: error.message,
    });
  }
});

/**
 * GET /api/pairs
 * Get all pairs (matches Factory.allPairs)
 */
app.get('/api/pairs', async (req, res) => {
  try {
    const poolManager = await getPoolManager();
    const pools = await poolManager.getAllPoolsInfo();

    res.json({
      code: 200,
      data: {
        pairs: pools.map(p => ({
          address: p.poolAddress,
          token0: p.tokenA,
          token1: p.tokenB,
          reserve0: p.reserveA,
          reserve1: p.reserveB,
        })),
      },
    });
  } catch (error) {
    console.error('Get pairs error:', error);
    res.status(500).json({
      code: 500,
      message: error.message,
    });
  }
});

/**
 * GET /api/pair/:tokenA/:tokenB
 * Get specific pair info
 */
app.get('/api/pair/:tokenA/:tokenB', async (req, res) => {
  try {
    const { tokenA, tokenB } = req.params;

    const poolManager = await getPoolManager();
    const pool = poolManager.getPool(tokenA, tokenB);

    if (!pool) {
      return res.status(404).json({
        code: 404,
        message: 'Pair not found',
      });
    }

    const info = await pool.getPoolInfo();

    res.json({
      code: 200,
      data: {
        address: info.poolAddress,
        token0: info.tokenA,
        token1: info.tokenB,
        reserve0: info.reserveA,
        reserve1: info.reserveB,
        totalSupply: info.totalLPSupply,
      },
    });
  } catch (error) {
    console.error('Get pair error:', error);
    res.status(500).json({
      code: 500,
      message: error.message,
    });
  }
});

// Health check
app.get('/health', async (req, res) => {
  const t0 = Date.now();
  try {
    await getOpsClient();
    const t1 = Date.now();
    res.json({
      ok: true,
      network: CONFIG.NETWORK,
      connectMs: t1 - t0,
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e.message,
    });
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    code: 500,
    message: err.message || 'Internal server error',
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    code: 404,
    message: 'Route not found',
  });
});

// Start server
async function start() {
  try {
    console.log('🚀 Starting Silverback Keeta Backend...');
    console.log(`📡 Network: ${CONFIG.NETWORK}`);
    
    await getOpsClient();
    await getPoolManager();
    
    const port = CONFIG.PORT;
    app.listen(port, () => {
      console.log(`✅ Server running on port ${port}`);
      console.log(`🔗 Base-compatible API: http://localhost:${port}/api`);
      console.log(`💓 Health: http://localhost:${port}/health`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

start();
