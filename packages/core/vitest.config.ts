import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@emr-webmcp/core',
    include: ['src/**/*.test.ts'],
  },
});
