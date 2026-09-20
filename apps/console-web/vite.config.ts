import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'esnext'
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8088',
        changeOrigin: true
      },
      '/health': {
        target: 'http://127.0.0.1:8088',
        changeOrigin: true
      },
      '/viewer': {
        target: 'http://127.0.0.1:8088',
        ws: true,
        changeOrigin: true
      }
    }
  }
});
