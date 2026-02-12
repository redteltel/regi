import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    base: '/regi/',
    plugins: [react()],
    resolve: { alias: { '@': path.resolve(process.cwd(), './') } },
    define: {
      // Define process.env.API_KEY to comply with coding guidelines using the VITE_ var
      'process.env.API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY || '')
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