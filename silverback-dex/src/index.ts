import express from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { brandSilverback } from './branding.js';
import { createPool } from './pools.js';
import { balanceOf, dexAccount, getBaseTokenId, send } from './keeta.js';
import { getAmountOut, getLpToMint } from './amm.js';
import { inbox, SwapIntent, LpAddIntent, LpRemIntent } from './inbox.js';
import { minOutFromSlippage, assertSlippage } from './slippage.js';
import { startListener, bus } from './listener.js';

const app = express();
app.use(express.json());

// --- boot
startListener();
bus.on('info', (m: unknown) => console.log('[listener]', m));
bus.on('error', (e: unknown) => console.error('[listener]', e));

// Simple health
app.get('/health', (_req: any, res: any) => res.json({ ok: true, dex: dexAccount.publicKeyString }));

app.post('/bootstrap/brand', async (_req: any, res: any, next: any) => {
  try {
    const staple = await brandSilverback();
    res.json({ dex: dexAccount.publicKeyString, staple });
  } catch (error) {
    next(error);
  }
});

app.post('/pool/create', async (req: any, res: any, next: any) => {
  try {
    const bodySchema = z.object({ quoteTokenId: z.string().min(1) });
    const { quoteTokenId } = bodySchema.parse(req.body);
    const out = await createPool(quoteTokenId);
    res.json(out);
  } catch (error) {
    next(error);
  }
});

app.get('/quote/swap', async (req: any, res: any, next: any) => {
  try {
    const querySchema = z.object({
      tokenIn: z.string().min(1),
      tokenOut: z.string().min(1),
      amountIn: z.string().min(1),
      maxSlippageBps: z.string().optional(),
    });
    const { tokenIn, tokenOut, amountIn, maxSlippageBps } = querySchema.parse(req.query);
    const rIn = await balanceOf(tokenIn);
    const rOut = await balanceOf(tokenOut);
    const quotedOut = getAmountOut(BigInt(amountIn), rIn, rOut);
    const minAmountOut = minOutFromSlippage(quotedOut, Number(maxSlippageBps ?? '50'));
    res.json({
      quotedOut: quotedOut.toString(),
      minAmountOut: minAmountOut.toString(),
      rIn: rIn.toString(),
      rOut: rOut.toString(),
    });
  } catch (error) {
    next(error);
  }
});

app.get('/quote/addLiquidity', async (req: any, res: any, next: any) => {
  try {
    const querySchema = z.object({
      tokenX: z.string().min(1),
      addKTA: z.string().min(1),
      addX: z.string().min(1),
    });
    const { tokenX, addKTA, addX } = querySchema.parse(req.query);
    const base = await getBaseTokenId();
    const reserveBase = await balanceOf(base);
    const reserveQuote = await balanceOf(tokenX);
    const totalLp = 0n;
    const lp = getLpToMint(BigInt(addKTA), BigInt(addX), reserveBase, reserveQuote, totalLp);
    res.json({
      lp: lp.toString(),
      reserveBase: reserveBase.toString(),
      reserveQuote: reserveQuote.toString(),
    });
  } catch (error) {
    next(error);
  }
});

// Intent creation endpoints
app.post('/intent/swap', async (req: any, res: any, next: any) => {
  try {
    const bodySchema = z.object({
      user: z.string().min(1),
      tokenIn: z.string().min(1),
      tokenOut: z.string().min(1),
      amountIn: z.string().min(1),
      minAmountOut: z.string().min(1),
      ttlMs: z.number().int().positive().optional(),
    });
    const parsed = bodySchema.parse({ ...req.body, ttlMs: req.body.ttlMs === undefined ? undefined : Number(req.body.ttlMs) });
    const id = `SWAP-${cryptoRandom()}`;
    const intent: SwapIntent = {
      kind: 'SWAP',
      id,
      user: parsed.user,
      tokenIn: parsed.tokenIn,
      tokenOut: parsed.tokenOut,
      amountIn: BigInt(parsed.amountIn),
      minAmountOut: BigInt(parsed.minAmountOut),
      createdAt: Date.now(),
      deadlineMs: parsed.ttlMs ?? 5 * 60_000,
      status: 'PENDING',
    };
    inbox.upsert(intent);
    res.json({ id, dex: dexAccount.publicKeyString });
  } catch (error) {
    next(error);
  }
});

app.post('/intent/lp/add', async (req: any, res: any, next: any) => {
  try {
    const bodySchema = z.object({
      user: z.string().min(1),
      tokenX: z.string().min(1),
      addKTA: z.string().min(1),
      addX: z.string().min(1),
      lpToken: z.string().min(1),
      mintAmount: z.string().min(1),
      ttlMs: z.number().int().positive().optional(),
    });
    const parsed = bodySchema.parse({ ...req.body, ttlMs: req.body.ttlMs === undefined ? undefined : Number(req.body.ttlMs) });
    const id = `LPADD-${cryptoRandom()}`;
    const intent: LpAddIntent = {
      kind: 'LPADD',
      id,
      user: parsed.user,
      kta: BigInt(parsed.addKTA),
      tokenX: parsed.tokenX,
      amountX: BigInt(parsed.addX),
      lpToken: parsed.lpToken,
      mintAmount: BigInt(parsed.mintAmount),
      createdAt: Date.now(),
      deadlineMs: parsed.ttlMs ?? 5 * 60_000,
      status: 'PENDING',
    };
    inbox.upsert(intent);
    res.json({ id, dex: dexAccount.publicKeyString });
  } catch (error) {
    next(error);
  }
});

app.post('/intent/lp/remove', async (req: any, res: any, next: any) => {
  try {
    const bodySchema = z.object({
      user: z.string().min(1),
      lpToken: z.string().min(1),
      lpAmount: z.string().min(1),
      expectKTA: z.string().min(1),
      expectXToken: z.string().min(1),
      expectXAmount: z.string().min(1),
      ttlMs: z.number().int().positive().optional(),
    });
    const parsed = bodySchema.parse({ ...req.body, ttlMs: req.body.ttlMs === undefined ? undefined : Number(req.body.ttlMs) });
    const id = `LPREM-${cryptoRandom()}`;
    const intent: LpRemIntent = {
      kind: 'LPREM',
      id,
      user: parsed.user,
      lpToken: parsed.lpToken,
      lpAmount: BigInt(parsed.lpAmount),
      expectKTA: BigInt(parsed.expectKTA),
      expectXToken: parsed.expectXToken,
      expectXAmount: BigInt(parsed.expectXAmount),
      createdAt: Date.now(),
      deadlineMs: parsed.ttlMs ?? 5 * 60_000,
      status: 'PENDING',
    };
    inbox.upsert(intent);
    res.json({ id, dex: dexAccount.publicKeyString });
  } catch (error) {
    next(error);
  }
});

// Settlement endpoints
app.post('/settle/swap', async (req: any, res: any, next: any) => {
  try {
    const bodySchema = z.object({ id: z.string().min(1) });
    const { id } = bodySchema.parse(req.body);
    const intent = inbox.get(id);
    if (!intent || intent.kind !== 'SWAP') {
      res.status(404).send('intent not found');
      return;
    }
    if (intent.status !== 'FILLED') {
      res.status(400).send('Intent not ready for settlement (must be FILLED)');
      return;
    }

    const rIn = await balanceOf(intent.tokenIn);
    const rOut = await balanceOf(intent.tokenOut);
    const quotedOut = getAmountOut(intent.amountIn, rIn, rOut);

    try {
      assertSlippage(quotedOut, intent.minAmountOut);
    } catch (error) {
      inbox.markFailed(id, error instanceof Error ? error.message : String(error));
      if (error instanceof Error && (error as any).code) {
        res.status(400).json({ error: (error as any).code, message: error.message });
      } else {
        res.status(400).json({ error: 'SLIPPAGE', message: error instanceof Error ? error.message : 'Slippage exceeded' });
      }
      return;
    }

    const staple = await send(intent.user, quotedOut, intent.tokenOut, id);
    inbox.markSettled(id, `sent ${quotedOut} ${intent.tokenOut}`);
    res.json({ staple, amountOut: quotedOut.toString() });
  } catch (error) {
    next(error);
  }
});

app.post('/settle/lp/remove', async (req: any, res: any, next: any) => {
  try {
    const bodySchema = z.object({ id: z.string().min(1) });
    const { id } = bodySchema.parse(req.body);
    const intent = inbox.get(id);
    if (!intent || intent.kind !== 'LPREM') {
      res.status(404).send('intent not found');
      return;
    }
    if (intent.status !== 'FILLED') {
      res.status(400).send('Intent not ready for settlement (must be FILLED)');
      return;
    }

    const s1 = await send(intent.user, intent.expectKTA, await getBaseTokenId(), id);
    const s2 = await send(intent.user, intent.expectXAmount, intent.expectXToken, id);

    // TODO: burn LP supply here with your mint/burn helper once wired
    // await dexClient.modTokenSupplyAndBalance(-intent.lpAmount, intent.lpToken);

    inbox.markSettled(id, `redeemed ${intent.lpAmount} LP`);
    res.json({ staples: [s1, s2] });
  } catch (error) {
    next(error);
  }
});

app.get('/inbox', (_req: any, res: any) => {
  res.json(inbox.all());
});

app.use((err: unknown, _req: any, res: any, _next: any) => {
  console.error(err);
  res.status(400).json({ error: err instanceof Error ? err.message : 'Unknown error' });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log('Silverback DEX service on', port);
  console.log('DEX account:', dexAccount.publicKeyString);
});

function cryptoRandom() {
  return randomUUID().replace(/-/g, '');
}
