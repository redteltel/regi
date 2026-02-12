import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Base path for deploying to a subdirectory (e.g., https://your-vps.com/regi/)
  base: '/regi/',
  plugins: [react()],
  server: {
    host: true, // Listen on all addresses for VPS access
    port: 5173
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false
  }
});