import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { configDefaults, defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { MAP_TILE_ORIGIN } from './src/features/network-map/map-tiles';

/**
 * Adds a Content-Security-Policy <meta> to the production index.html. The console keeps the
 * controller session token in localStorage (the upstream ZAC contract), so limiting what an
 * injected script could do is the main XSS backstop. Inline scripts are allowed by hash only.
 * Build-only: the Vite dev server injects inline scripts/styles this policy would block.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'bpc-content-security-policy',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const scriptHashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
          (m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`,
        );
        const policy = [
          "default-src 'self'",
          `script-src 'self' ${scriptHashes.join(' ')}`.trim(),
          // React Flow and the canvas position elements with inline style attributes.
          "style-src 'self' 'unsafe-inline'",
          // The Network Map's basemap tiles are <img> elements loaded from the tile server.
          `img-src 'self' data: blob: ${MAP_TILE_ORIGIN}`,
          "font-src 'self' data:",
          // The admin may point the console at any controller URL; controllers serve HTTPS.
          "connect-src 'self' https:",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join('; ');
        // After the charset declaration (which should stay first) and before any script.
        return html.replace(
          /<meta charset="UTF-8" \/>/i,
          (m) => `${m}\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
        );
      },
    },
  };
}

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  base: './',
  define: {
    // Shown in the sidebar and on the login screen; the release workflow ties tags to this.
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  build: {
    target: 'esnext',
    outDir: 'dist',
    assetsDir: 'assets',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // Agent worktrees under .claude/ hold full copies of src; don't run their specs twice.
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
});
