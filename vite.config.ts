import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, path.resolve('.'), '');

  // Prioritize VITE_GEMINI_API_KEY, then API_KEY
  const apiKey = env.VITE_GEMINI_API_KEY || env.API_KEY || '';

  return {
    base: '/regi/',
    plugins: [react()],
    resolve: { alias: { '@': path.resolve('./') } },
    define: {
      // Standardize on process.env.API_KEY as per Google GenAI SDK guidelines
      'process.env.API_KEY': JSON.stringify(apiKey),
    },
    server: {
      host: true,
      port: 5173
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      sourcemap: false
    }
  };
});
