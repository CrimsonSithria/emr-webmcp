import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const r = (relativePath: string) => fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  root: r('./harness'),
  resolve: {
    alias: {
      '@emr-webmcp/core': r('../../packages/core/src/index.ts'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 4177,
    strictPort: true,
  },
});
