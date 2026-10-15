import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import base from '../vite.config.ts';
import { reviewWorkbenchPlugin } from '../tools/review/server.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export default mergeConfig(base, defineConfig({
  root,
  plugins: [reviewWorkbenchPlugin({ root })],
  server: { host: '127.0.0.1', port: 5180, strictPort: true, open: false },
  build: {
    outDir: 'dist-review',
    rollupOptions: { input: fileURLToPath(new URL('./index.html', import.meta.url)) },
  },
}));
