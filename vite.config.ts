import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  // Base path for deploying to a subdirectory
  base: '/regi/',
  plugins: [react()],
  resolve: { alias: { '@': path.resolve('./') } },
  server: {
    host: true,
    port: 5173
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false
  }
});