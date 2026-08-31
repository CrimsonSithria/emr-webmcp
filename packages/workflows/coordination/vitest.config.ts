import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@emr-webmcp/coordination',
    include: ['src/**/*.test.ts'],
  },
});
