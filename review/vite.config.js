import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import base from '../vite.config.ts';
import { reviewWorkbenchPlugin } from '../tools/review/server.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export default mergeConfig(base, defineConfig({
  root,
  // 5174(나주)와 같은 node_modules/.vite 를 쓰면 둘이 번갈아 재최적화하며 503 이 난다 — 캐시를 따로 둔다
  cacheDir: 'node_modules/.vite-review',
  plugins: [reviewWorkbenchPlugin({ root })],
  server: { host: '127.0.0.1', port: 5180, strictPort: true, open: false },
  build: {
    outDir: 'dist-review',
    rollupOptions: { input: fileURLToPath(new URL('./index.html', import.meta.url)) },
  },
}));
