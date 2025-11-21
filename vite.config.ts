import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import tsconfigPaths from "vite-tsconfig-paths";

// https://vitejs.dev/config/
export default defineConfig(async ({ mode }) => {
  const plugins = [
    react({
      jsxRuntime: 'automatic',
    }),
    tsconfigPaths()
  ];

  // Only add express plugin in development mode
  // In production, the server is run separately via node-build.ts
  if (mode === 'development') {
    // Dynamically import the plugin only in dev mode
    const expressPlugin: Plugin = {
      name: "express-plugin",
      apply: "serve",
      async configureServer(server) {
        const serverPath = path.resolve(__dirname, 'server/index.ts');
        const { createServer } = await import(serverPath);
        const app = createServer();
        server.middlewares.use(app);
      },
    };
    plugins.push(expressPlugin);
  }

  return {
    server: {
      host: "::",
      port: 8080,
      fs: {
        allow: [".", "./client", "./shared"],
        deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "server/**"],
      },
    },
    build: {
      outDir: "dist/spa",
      minify: 'esbuild', // Ensure minification is enabled
      rollupOptions: {
        output: {
          manualChunks: {
            // Vendor chunks - split large dependencies
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-web3': ['wagmi', 'viem'],
            'vendor-ui': [
              '@radix-ui/react-dialog',
              '@radix-ui/react-dropdown-menu',
              '@radix-ui/react-select',
              '@radix-ui/react-tabs',
              '@radix-ui/react-toast',
            ],
          },
        },
      },
      chunkSizeWarningLimit: 1000, // Increase limit to 1MB to reduce warnings
    },
    esbuild: {
      // Configure esbuild for proper production builds
      // Temporarily enable console logs in production for debugging
      drop: mode === 'production' ? ['debugger'] : [],
    },
    plugins,
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./client"),
        "@shared": path.resolve(__dirname, "./shared"),
      },
    },
  };
});
