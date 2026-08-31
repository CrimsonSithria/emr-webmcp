import { AdapterError, type ConfirmedFollowup } from '@emr-webmcp/core';
import { describe, expect, it, vi } from 'vitest';

import { createOpenmrsAdapter, type OpenmrsFetch } from './openmrs-adapter.js';
import { createOpenmrsMswFetch, createOpenmrsMswStore } from './testing.js';

const NOW = new Date('2026-08-31T12:00:00.000Z');
const CAREPLAN_PATH = '/ws/rest/v1/tasks/careplan';

const ADA = { id: 'patient-01', display: 'Ada Lovelace' };
const GRACE = { id: 'patient-03', display: 'Grace Hopper' };

describe('createFollowup confirmation', () => {
  it('runs a preflight CarePlan query before posting a valid follow-up exactly once', async () => {
    const store = createOpenmrsMswStore();
    const inner = createOpenmrsMswFetch(store);
    const fetch = vi.fn<OpenmrsFetch>(inner);
    const adapter = createOpenmrsAdapter({ fetch, now: () => NOW });

    const created = await adapter.createFollowup(validInput());

    expect(created.sourceReference).toBe('Observation/obs-03');
    expect(created.patient).toEqual(GRACE);
    expect(created.title).toBe('Follow up glucose');
    expect(postCount(fetch)).toBe(1);
    expect(carePlanGets(fetch).length).toBeGreaterThan(0);

    const firstCarePlanGet = firstIndex(fetch, isCarePlanGet);
    const firstCarePlanPost = firstIndex(fetch, isCarePlanPost);
    expect(firstCarePlanGet).toBeGreaterThanOrEqual(0);
    expect(firstCarePlanPost).toBeGreaterThan(firstCarePlanGet);
    expect(fetch.mock.calls.filter(([path, init]) => isCarePlanPost(path, init))).toHaveLength(1);
    expect(
      fetch.mock.calls.some(([path, init]) => isCarePlanPost(path, init) && path.startsWith(CAREPLAN_PATH)),
    ).toBe(true);
  });

  it('returns conflict and posts nothing when an active duplicate already exists', async () => {
    const store = createOpenmrsMswStore();
    const inner = createOpenmrsMswFetch(store);
    const fetch = vi.fn<OpenmrsFetch>(inner);
    const adapter = createOpenmrsAdapter({ fetch, now: () => NOW });

    await expectAdapterError(
      adapter.createFollowup({
        patient: ADA,
        title: 'Follow up potassium',
        rationale: 'Should collide with the active potassium task.',
        priority: 'high',
        sourceReference: 'Observation/obs-01',
      }),
      'conflict',
    );
    expect(postCount(fetch)).toBe(0);
    expect(carePlanGets(fetch).length).toBeGreaterThan(0);
  });

  it('refuses confirmation without privilege and never POSTs', async () => {
    const store = createOpenmrsMswStore();
    const fetch = vi.fn<OpenmrsFetch>(createOpenmrsMswFetch(store));
    const adapter = createOpenmrsAdapter({
      fetch,
      now: () => NOW,
      canCreateFollowup: () => false,
    });

    await expectPublicError(adapter.createFollowup(validInput()), {
      code: 'unauthorized',
      leaked: 'secret-token-xyz',
    });
    expect(postCount(fetch)).toBe(0);
  });

  it('returns not-found when the source observation cannot be re-fetched', async () => {
    const store = createOpenmrsMswStore();
    const fetch = vi.fn<OpenmrsFetch>(createOpenmrsMswFetch(store));
    const adapter = createOpenmrsAdapter({ fetch, now: () => NOW });

    await expectAdapterError(
      adapter.createFollowup({
        ...validInput(),
        sourceReference: 'Observation/missing-result',
      }),
      'not-found',
    );
    expect(postCount(fetch)).toBe(0);
  });

  it('returns invalid-input when the source belongs to a different patient', async () => {
    const store = createOpenmrsMswStore();
    const fetch = vi.fn<OpenmrsFetch>(createOpenmrsMswFetch(store));
    const adapter = createOpenmrsAdapter({ fetch, now: () => NOW });

    await expectAdapterError(
      adapter.createFollowup({
        patient: ADA,
        title: 'Wrong patient follow-up',
        rationale: 'Source is Grace Hopper glucose.',
        priority: 'high',
        sourceReference: 'Observation/obs-03',
      }),
      'invalid-input',
    );
    expect(postCount(fetch)).toBe(0);
  });

  it('maps a repeated server conflict to the canonical conflict error without leaking bodies', async () => {
    const store = createOpenmrsMswStore();
    const inner = createOpenmrsMswFetch(store);
    const fetch = vi.fn<OpenmrsFetch>(async (path, init) => {
      if (isCarePlanPost(path, init)) {
        return { status: 409, data: { error: 'secret-token-xyz', body: 'duplicate-careplan' } };
      }
      return inner(path, init);
    });
    const adapter = createOpenmrsAdapter({ fetch, now: () => NOW });

    await expectPublicError(adapter.createFollowup(validInput()), {
      code: 'conflict',
      leaked: 'secret-token-xyz',
    });
    expect(postCount(fetch)).toBe(1);
  });
});

function validInput(): ConfirmedFollowup {
  return {
    patient: GRACE,
    title: 'Follow up glucose',
    rationale: 'Recorded critical-high glucose has no active task.',
    priority: 'high',
    sourceReference: 'Observation/obs-03',
  };
}

function postCount(fetch: ReturnType<typeof vi.fn<OpenmrsFetch>>): number {
  return fetch.mock.calls.filter(([path, init]) => isCarePlanPost(path, init)).length;
}

function carePlanGets(fetch: ReturnType<typeof vi.fn<OpenmrsFetch>>): string[] {
  return fetch.mock.calls.filter(([path, init]) => isCarePlanGet(path, init)).map(([path]) => path);
}

function isCarePlanPost(path: string, init?: { method?: string }): boolean {
  return (init?.method ?? 'GET').toUpperCase() === 'POST' && carePlanPath(path);
}

function isCarePlanGet(path: string, init?: { method?: string }): boolean {
  return (init?.method ?? 'GET').toUpperCase() === 'GET' && carePlanPath(path);
}

function carePlanPath(path: string): boolean {
  return new URL(path, 'http://openmrs.local').pathname === CAREPLAN_PATH;
}

function firstIndex(
  fetch: ReturnType<typeof vi.fn<OpenmrsFetch>>,
  predicate: (path: string, init?: { method?: string }) => boolean,
): number {
  return fetch.mock.calls.findIndex(([path, init]) => predicate(path, init));
}

async function expectAdapterError(action: Promise<unknown>, code: string): Promise<void> {
  try {
    await action;
    throw new Error(`expected AdapterError with code ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toMatchObject({ code });
  }
}

async function expectPublicError(
  action: Promise<unknown>,
  expected: { code: string; leaked: string },
): Promise<void> {
  try {
    await action;
    throw new Error(`expected AdapterError with code ${expected.code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toMatchObject({ code: expected.code });
    if (!(error instanceof AdapterError)) {
      throw error;
    }
    expect(error.message).not.toContain(expected.leaked);
    expect(error.message).not.toContain('duplicate-careplan');
    expect(error.message).not.toContain('http://');
    expect(error.message).not.toContain('/ws/');
  }
}
