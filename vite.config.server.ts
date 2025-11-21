import { defineConfig } from "vite";
import path from "path";

// Server build configuration
export default defineConfig({
  root: process.cwd(), // Explicitly set root to current working directory
  build: {
    lib: {
      entry: "server/node-build.ts", // Relative to root
      name: "server",
      fileName: "node-build",
      formats: ["es"],
    },
    outDir: "dist/server",
    target: "node22",
    ssr: true,
    rollupOptions: {
      external: [
        // Node.js built-ins
        "fs",
        "path",
        "url",
        "http",
        "https",
        "os",
        "crypto",
        "stream",
        "util",
        "events",
        "buffer",
        "querystring",
        "child_process",
        "fs/promises",
        // External dependencies that should not be bundled
        "express",
        "cors",
        "dotenv",
        "dotenv/config",
        "pg",
        "@keetanetwork/keetanet-client",
        // "@keetanetwork/anchor", // Not used - anchor functionality not implemented yet
      ],
      output: {
        format: "es",
        entryFileNames: "[name].mjs",
        // Preserve module structure to avoid circular dependency issues
        preserveModules: true,
        preserveModulesRoot: 'server',
      },
    },
    minify: false, // Keep readable for debugging
    sourcemap: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./client"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});
