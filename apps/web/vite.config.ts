import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Excalidraw checks this at runtime (it also supports Preact).
  define: { 'process.env.IS_PREACT': JSON.stringify('false') },
  server: {
    port: 5173,
    // ws: live editing runs over a WebSocket on /api/collab.
    proxy: { '/api': { target: 'http://localhost:3000', ws: true } },
  },
  build: { outDir: 'dist', sourcemap: true },
});
