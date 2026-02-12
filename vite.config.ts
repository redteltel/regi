import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // Listen on all addresses (0.0.0.0) for VPS access
    port: 5173
  }
  // Removed process.env define since we are hardcoding the API key in the service file
  // to prevent "process is not defined" errors in the browser.
});