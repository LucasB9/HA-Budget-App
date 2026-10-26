import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `base: './'` is mandatory: Home Assistant Ingress serves the app under a dynamic path prefix,
// so every asset URL must be relative.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false, target: 'es2022' },
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:3000', changeOrigin: false } },
  },
});
