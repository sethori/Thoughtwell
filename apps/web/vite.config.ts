import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The desktop app loads the build from app://thoughtwell/, so asset links must be relative.
  base: './',
  // Excalidraw checks this at runtime (it also supports Preact).
  define: { 'process.env.IS_PREACT': JSON.stringify('false') },
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist', sourcemap: true },
});
