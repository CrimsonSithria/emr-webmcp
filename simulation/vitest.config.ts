import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@emr-webmcp/simulation',
    include: ['src/**/*.test.ts'],
  },
});
