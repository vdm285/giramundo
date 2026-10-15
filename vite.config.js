import { defineConfig } from 'vite';

// GitHub Pages serves the site from /interactive-globe/. Local dev stays at /.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  server: { port: 5173, host: true },
});
