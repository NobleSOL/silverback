import "dotenv/config";
import express from "express";
import cors from "cors";
import keetaRoutes from "./keeta-routes.ts";
import { getSilverbackFXAnchorRoutes } from "./keeta-impl/services/fx-anchor-server.js";

export async function createServer() {
  const app = express();

  // CORS configuration - Allow Vercel frontend and development
  const corsOptions = {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow requests with no origin (like mobile apps, curl, Postman)
      if (!origin) return callback(null, true);

      // Allow localhost for development
      if (origin.includes('localhost')) return callback(null, true);

      // Allow all Vercel deployments (production + preview)
      if (origin.includes('vercel.app')) return callback(null, true);

      // Allow Render.com (for backend-to-backend calls if needed)
      if (origin.includes('onrender.com')) return callback(null, true);

      // Allow production domain
      if (origin.includes('silverbackdefi.app')) return callback(null, true);

      // Reject all other origins
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  };

  // Middleware
  app.use(cors(corsOptions));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Example API routes
  app.get("/api/ping", (_req, res) => {
    const ping = process.env.PING_MESSAGE ?? "ping";
    res.json({ message: ping });
  });

  // Keeta DEX API routes
  app.use(keetaRoutes);

  // FX Anchor routes (for resolver discovery)
  // Mount at /fx so Silverback FX endpoints are at:
  // - https://dexkeeta.onrender.com/fx/ (metadata)
  // - https://dexkeeta.onrender.com/fx/api/getQuote
  // - https://dexkeeta.onrender.com/fx/api/createExchange
  // - https://dexkeeta.onrender.com/fx/api/getExchangeStatus
  try {
    const fxRoutes = await getSilverbackFXAnchorRoutes();
    app.use('/fx', fxRoutes);
    console.log('✅ FX Anchor routes mounted at /fx');
  } catch (error) {
    console.error('⚠️  FX Anchor routes failed to initialize:', error.message);
    console.error('   Continuing without FX resolver support');
  }

  return app;
}
