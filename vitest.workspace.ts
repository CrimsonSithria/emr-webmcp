import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/*',
  'packages/adapters/*',
  {
    test: {
      name: 'contract',
      include: ['tests/contract/src/**/*.test.ts'],
    },
  },
]);
