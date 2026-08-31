import { findUnlatched } from '@emr-webmcp/lablatch';
import { describe, expect, it } from 'vitest';

import { createOpenmrsAdapter } from './openmrs-adapter.js';
import { createOpenmrsMswFetch, createOpenmrsMswStore } from './testing.js';

const NOW = new Date('2026-08-31T12:00:00.000Z');

describe('findUnlatched against OpenMRS', () => {
  it('returns abnormal results that have no active correlated follow-up', async () => {
    const store = createOpenmrsMswStore();
    const adapter = createOpenmrsAdapter({
      fetch: createOpenmrsMswFetch(store),
      now: () => NOW,
      getActivePatientId: () => store.activePatientId,
    });

    const result = await findUnlatched(adapter);

    expect(result.items.map((item) => item.id).sort()).toEqual(['obs-03', 'obs-04', 'obs-08']);
    expect(result.truncated).toBe(false);
  });
});
