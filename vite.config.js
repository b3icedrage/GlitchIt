import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { cpSync, existsSync } from 'fs';

// Multi-page HTML entries
const htmlPages = [
  'index.html', 'auth.html', 'about.html', 'terms.html', 'privacy.html',
  'search.html', 'glitches.html', 'messages.html', 'chat.html', 'live.html',
  'activity.html', 'channels.html', 'shop.html', 'profile.html', 'user.html',
  'premium.html', 'wallet.html', 'receipt.html', 'camera.html',
];

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-static-assets',
      closeBundle() {
        const root = resolve(__dirname);
        const out = resolve(__dirname, 'dist');

        // Copy static files
        for (const f of ['robots.txt', 'ads.txt', 'manifest.json', 'sw.js', 'icon.svg', 'vercel.json']) {
          const src = resolve(root, f);
          if (existsSync(src)) cpSync(src, resolve(out, f));
        }

        // Copy src/ (CSS + JS)
        cpSync(resolve(root, 'src'), resolve(out, 'src'), { recursive: true });

        // Copy api/ (server-side code for hosting)
        cpSync(resolve(root, 'api'), resolve(out, 'api'), { recursive: true });
      },
    },
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: Object.fromEntries(
        htmlPages.map((p) => [p.replace('.html', ''), resolve(__dirname, p)])
      ),
    },
  },
});
