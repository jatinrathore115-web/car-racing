import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths: the built game in dist/ runs from any static server or sub-folder
  // (VS Code Live Server, GitHub Pages, itch.io, a plain file host...).
  base: './',
  server: { port: 5173, open: false },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
});
