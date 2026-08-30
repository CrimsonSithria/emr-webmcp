import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/*',
      'packages/adapters/*',
      {
        test: {
          name: 'contract',
          include: ['tests/contract/src/**/*.test.ts'],
        },
      },
    ],
  },
});
