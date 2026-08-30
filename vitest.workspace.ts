import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/*',
  'packages/adapters/*',
  'tests/*',
]);
