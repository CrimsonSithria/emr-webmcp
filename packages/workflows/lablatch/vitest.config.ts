import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@emr-webmcp/lablatch',
    include: ['src/**/*.test.ts'],
  },
});
