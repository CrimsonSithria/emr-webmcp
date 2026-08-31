import { describe, expect, it } from 'vitest';

describe('@emr-webmcp/openmrs-adapter', () => {
  it('exposes a loadable package entrypoint', async () => {
    await expect(import('./index.js')).resolves.toBeTypeOf('object');
  });
});
