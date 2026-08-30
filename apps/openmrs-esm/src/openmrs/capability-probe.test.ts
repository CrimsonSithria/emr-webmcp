import type { EmrCapability } from '@emr-webmcp/core';
import { describe, expect, it, vi } from 'vitest';

import { PHASE1_CAPABILITIES, createDefaultCapabilityProbe } from './capability-probe';

const TASK_CAPABILITIES: readonly EmrCapability[] = ['list-followups', 'create-followup'];
const SECRET = 'secret-token-xyz';

describe('createDefaultCapabilityProbe', () => {
  it('returns an empty set when unauthenticated and does not fetch', async () => {
    const fetch = vi.fn();
    const probe = createDefaultCapabilityProbe({
      fetch,
      isAuthenticated: () => false,
    });

    await expect(probe()).resolves.toEqual(new Set());
    expect(fetch).not.toHaveBeenCalled();
  });

  it('drops list-followups and create-followup when Tasks answers 404', async () => {
    const fetch = vi.fn(async () => ({ status: 404, data: { secret: SECRET } }));
    const capabilities = await createDefaultCapabilityProbe({
      fetch,
      isAuthenticated: () => true,
    })();

    expect(capabilities.has('list-followups')).toBe(false);
    expect(capabilities.has('create-followup')).toBe(false);
    expect(capabilities.has('search-patients')).toBe(true);
    expect(JSON.stringify([...capabilities])).not.toContain(SECRET);
  });

  it('treats a thrown 404 as Tasks absent', async () => {
    const fetch = vi.fn(async () => {
      throw { response: { status: 404, data: { secret: SECRET } } };
    });
    const capabilities = await createDefaultCapabilityProbe({
      fetch,
      isAuthenticated: () => true,
    })();

    expect(TASK_CAPABILITIES.every((capability) => !capabilities.has(capability))).toBe(true);
  });

  it('keeps task capabilities when Tasks answers 400 present-but-filtered', async () => {
    const fetch = vi.fn(async () => ({ status: 400, data: { secret: SECRET } }));
    const capabilities = await createDefaultCapabilityProbe({
      fetch,
      isAuthenticated: () => true,
    })();

    expect(capabilities).toEqual(new Set(PHASE1_CAPABILITIES));
    expect(JSON.stringify([...capabilities])).not.toContain(SECRET);
  });

  it('keeps task capabilities on non-404 success and error', async () => {
    const statuses = [200, 401, 403, 500];
    for (const status of statuses) {
      const fetch = vi.fn(async () => ({ status, data: { secret: SECRET } }));
      const capabilities = await createDefaultCapabilityProbe({
        fetch,
        isAuthenticated: () => true,
      })();
      expect(capabilities).toEqual(new Set(PHASE1_CAPABILITIES));
    }

    const thrown = vi.fn(async () => {
      throw new Error('network down');
    });
    const retained = await createDefaultCapabilityProbe({
      fetch: thrown,
      isAuthenticated: () => true,
    })();
    expect(retained).toEqual(new Set(PHASE1_CAPABILITIES));
  });

  it('always sends patient and a small limit on the CarePlan collection probe', async () => {
    const fetch = vi.fn(async () => ({ status: 200, data: {} }));
    await createDefaultCapabilityProbe({
      fetch,
      isAuthenticated: () => true,
    })();

    expect(fetch).toHaveBeenCalledTimes(1);
    const path = firstFetchPath(fetch);
    const url = new URL(path, 'http://openmrs.local');
    expect(url.pathname).toBe('/ws/rest/v1/tasks/careplan');
    expect(url.searchParams.get('patient')).toBe('capability-probe');
    expect(url.searchParams.get('limit')).toBe('1');
  });

  it('uses the active session patient when one is known', async () => {
    const fetch = vi.fn(async () => ({ status: 200, data: {} }));
    await createDefaultCapabilityProbe({
      fetch,
      isAuthenticated: () => true,
      getPatientId: () => 'patient-ada',
    })();

    expect(new URL(firstFetchPath(fetch), 'http://openmrs.local').searchParams.get('patient')).toBe(
      'patient-ada',
    );
  });
});

function firstFetchPath(fetch: { mock: { calls: unknown[][] } }): string {
  const first = fetch.mock.calls[0];
  if (first === undefined || first.length === 0) {
    throw new Error('expected a CarePlan probe fetch');
  }
  return String(first[0]);
}
