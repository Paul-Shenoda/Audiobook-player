import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: '.',
  base: '/Audiobook-player/',
  build: {
    outDir: 'dist',
  },
  resolve: {
    alias: {
      jsmediatags: path.resolve(
        __dirname,
        'node_modules/jsmediatags/dist/jsmediatags.min.js',
      ),
    },
  },
  optimizeDeps: {
    include: ['epubjs', 'jsmediatags', 'idb'],
  },
  plugins: [
    VitePWA({
      // Keep the hand-written public/manifest.json instead of generating one.
      manifest: false,
      registerType: 'prompt',
      includeAssets: ['manifest.json', 'icons/icon.svg'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Night Shelf fonts (Google Fonts): CSS revalidates, font files are immutable.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-styles' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-files',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
