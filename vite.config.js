import { defineConfig } from 'vite';

export default defineConfig({
  // The game is fully ES-module based with no bare imports (Three.js is
  // vendored in vendor/), so it runs natively on static hosts like
  // GitHub Pages without any build step. Vite is only used for local dev.
  base: './',
  server: {
    host: true, // expose on 0.0.0.0 so the sandbox preview can reach it
    port: 5173,
    allowedHosts: true, // accept the sandbox preview host
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 700,
  },
});
