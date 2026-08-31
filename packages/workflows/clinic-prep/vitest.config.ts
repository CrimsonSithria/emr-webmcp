import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@emr-webmcp/clinic-prep',
    include: ['src/**/*.test.ts'],
  },
});
