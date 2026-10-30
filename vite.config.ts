import { defineConfig, type Plugin } from 'vite';

/**
 * Production HTML clean-up:
 * - drops the dev-only "source fallback" block (deployed builds must never show it)
 * - loads the bundle as a classic deferred script instead of an ES module, so the built game also
 *   runs when dist/index.html is opened straight from disk (file://), where browsers block modules.
 */
function portableBuild(): Plugin {
  return {
    name: 'apex-portable-build',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html
          .replace(/<!-- source-fallback:start[\s\S]*?source-fallback:end -->\s*/g, '')
          .replace(/<script type="module" crossorigin src=/g, '<script defer src=')
          .replace(/<link rel="modulepreload"[^>]*>\s*/g, '')
          .replace(/<link rel="stylesheet" crossorigin href=/g, '<link rel="stylesheet" href=');
      },
    },
  };
}

export default defineConfig({
  // Relative asset paths: the built game in dist/ runs from any static server, sub-folder or file://
  // (VS Code Live Server, Vercel, GitHub Pages, itch.io, double-clicking dist/index.html...).
  base: './',
  plugins: [portableBuild()],
  server: { port: 5173, open: false },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    modulePreload: false,
    rollupOptions: {
      // a single self-contained classic script (no ES-module loading required)
      output: { format: 'iife', inlineDynamicImports: true },
    },
  },
});
