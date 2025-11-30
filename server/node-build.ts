import path from "path";
import { createServer } from "./index";
import * as express from "express";

const app = createServer();
const port = process.env.PORT || 3000;

// In production, serve the built SPA files
const __dirname = import.meta.dirname;
const distPath = path.join(__dirname, "../spa");

// Serve static files
app.use(express.static(distPath));

// Handle React Router - serve index.html for all non-API routes
// Express 5 uses middleware instead of wildcard routes
app.use((req, res, next) => {
  // Don't serve index.html for API routes or FX routes
  if (req.path.startsWith("/api/") || req.path.startsWith("/fx/") || req.path.startsWith("/health")) {
    return next();
  }

  // Serve index.html for all other routes (SPA routing)
  res.sendFile(path.join(distPath, "index.html"));
});

app.listen(port, async () => {
  console.log(`🚀 Fusion Starter server running on port ${port}`);
  console.log(`📱 Frontend: http://localhost:${port}`);
  console.log(`🔧 API: http://localhost:${port}/api`);

  // Start snapshot recorder for APY/volume calculation
  console.log('\n📸 Starting pool snapshot recorder...');
  const { SnapshotRecorder } = await import('./keeta-impl/utils/snapshot-recorder.js');
  const recorder = new SnapshotRecorder();

  // Record initial snapshot on startup
  try {
    await recorder.recordAllSnapshots();
    console.log('✅ Initial snapshot recorded\n');
  } catch (error) {
    console.error('❌ Failed to record initial snapshot:', error.message);
  }

  // Schedule hourly snapshot recording
  const HOUR_MS = 60 * 60 * 1000;
  setInterval(async () => {
    try {
      console.log('\n⏰ Running hourly snapshot recording...');
      await recorder.recordAllSnapshots();
    } catch (error) {
      console.error('❌ Hourly snapshot failed:', error.message);
    }
  }, HOUR_MS);

  console.log(`⏰ Snapshot recorder scheduled (every hour)\n`);

  // Start FX Anchor server on port 3001
  console.log('🔗 Starting FX Anchor server...');
  try {
    const { startSilverbackFXAnchorServer } = await import('./keeta-impl/services/fx-anchor-server.js');
    await startSilverbackFXAnchorServer(3001);
  } catch (error) {
    console.error('⚠️  FX Anchor server failed to start:', error.message);
    console.error('   Continuing without FX resolver support');
  }
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("🛑 Received SIGTERM, shutting down gracefully");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("🛑 Received SIGINT, shutting down gracefully");
  process.exit(0);
});
