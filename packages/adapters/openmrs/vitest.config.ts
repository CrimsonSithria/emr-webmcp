import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@emr-webmcp/openmrs-adapter',
    include: ['src/**/*.test.ts'],
  },
});
