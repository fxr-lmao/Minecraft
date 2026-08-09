import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths -> the built site works from any subpath,
  // including GitHub Pages project pages (https://user.github.io/<repo>/).
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
