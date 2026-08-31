import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      // `packages/*` also matches `packages/adapters` as a project and would
      // double-run adapter tests. List leaf package roots only.
      'packages/core',
      'packages/adapters/*',
      'packages/workflows/*',
      'simulation',
      {
        test: {
          name: 'distribution-openmrs',
          include: ['distribution/openmrs/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'contract',
          include: ['tests/contract/src/**/*.test.ts'],
        },
      },
    ],
  },
});
