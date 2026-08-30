import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@emr-webmcp/contract-fixture',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
});
