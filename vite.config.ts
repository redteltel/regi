import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, path.resolve('.'), '');

  // Prioritize VITE_GEMINI_API_KEY, then API_KEY
  const apiKey = env.VITE_GEMINI_API_KEY || env.API_KEY || '';

  return {
    base: '/regi/',
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        // DATA.csv と ServiceItems.csv をキャッシュ対象から除外
        includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
        workbox: {
          // CSVファイルはService Workerのキャッシュから完全に除外
          globIgnores: ['**/*.csv'],
          // ネットワーク優先: CSVは常にサーバーから最新を取得
          runtimeCaching: [
            {
              urlPattern: /\.csv(\?.*)?$/,
              handler: 'NetworkOnly',
            },
          ],
        },
        manifest: {
          name: 'パナランドフクシマ',
          short_name: 'Pixel POS',
          description: 'Pixel POS for Panaland Fukushima',
          theme_color: '#ffffff',
          icons: [
            {
              src: 'icon-192.png',
              sizes: '192x192',
              type: 'image/png'
            },
            {
              src: 'icon-512.png',
              sizes: '512x512',
              type: 'image/png'
            },
            {
              src: 'icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable'
            }
          ]
        }
      })
    ],
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
