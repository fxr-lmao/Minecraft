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
    // Output into docs/ so GitHub Pages can serve the built site directly
    // ("Deploy from a branch" → folder /docs). The build uses relative asset
    // paths (base: './') so it works from any Pages subpath.
    outDir: 'docs',
    emptyOutDir: true,
    target: 'es2020',
    chunkSizeWarningLimit: 700,
  },
});
