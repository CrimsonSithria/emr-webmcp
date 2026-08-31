import { describe, expect, it, vi } from 'vitest';

import { AdapterError } from '../contracts/adapter-error.js';
import type { EmrAdapter } from '../contracts/adapter.js';
import type { ConfirmedFollowup, FollowupDraft } from '../contracts/dtos.js';
import { DraftStore } from './draft-store.js';

const USER_A = 'user-ada';
const USER_B = 'user-grace';
const DRAFT_ID = '11111111-1111-4111-8111-111111111111';
const T0 = new Date('2026-08-31T12:00:00.000Z');
const THIRTY_MINUTES_MS = 30 * 60 * 1000;

const VALID_INPUT: ConfirmedFollowup = {
  patient: { id: 'patient-01', display: 'Ada Lovelace' },
  title: 'Follow up potassium',
  rationale: 'Recorded high potassium 5.8 mmol/L has no active task.',
  priority: 'high',
  dueAt: '2026-09-01T09:00:00.000Z',
  assignee: { id: 'person-dr-chen', display: 'Dr. Chen', type: 'person' },
  sourceReference: 'Observation/obs-01',
};

describe('DraftStore', () => {
  it('rejects invalid stage input without creating a draft', () => {
    const store = makeStore();

    expectStageInvalid(store, { ...VALID_INPUT, title: '' });
    expectStageInvalid(store, { ...VALID_INPUT, title: '   ' });
    expectStageInvalid(store, { ...VALID_INPUT, rationale: '' });
    expectStageInvalid(store, { ...VALID_INPUT, patient: { id: '', display: 'Ada Lovelace' } });
    expectStageInvalid(store, { ...VALID_INPUT, patient: { id: 'patient-01', display: '' } });
    expectStageInvalid(store, { ...VALID_INPUT, priority: 'urgent' as ConfirmedFollowup['priority'] });
    expectStageInvalid(store, { ...VALID_INPUT, title: 'x'.repeat(201) });
    expectStageInvalid(store, { ...VALID_INPUT, rationale: 'x'.repeat(2001) });
    expectStageInvalid(store, { ...VALID_INPUT, dueAt: 'tomorrow' });
    expectStageInvalid(store, {
      ...VALID_INPUT,
      assignee: { id: '', display: 'Dr. Chen', type: 'person' },
    });
    expect(store.diagnostics()).toEqual({ count: 0, draftIds: [] });
  });

  it('stages a validated draft owned by the current session user', () => {
    const store = makeStore();
    const draft = store.stage(VALID_INPUT);

    expect(draft).toEqual({
      draftId: DRAFT_ID,
      patient: VALID_INPUT.patient,
      title: VALID_INPUT.title,
      rationale: VALID_INPUT.rationale,
      priority: VALID_INPUT.priority,
      dueAt: '2026-09-01T09:00:00.000Z',
      assignee: { id: 'person-dr-chen', display: 'Dr. Chen', type: 'person' },
      sourceReference: 'Observation/obs-01',
    } satisfies FollowupDraft);
    expect(store.peek(DRAFT_ID)).toEqual(draft);
  });

  it('does not accept or invoke an EmrAdapter while staging', () => {
    const adapter = fakeAdapter();
    const store = makeStore();

    expect(store.stage.length).toBe(1);
    const draft = store.stage(VALID_INPUT);

    expect(draft.draftId).toBe(DRAFT_ID);
    expect(adapter.createFollowup).not.toHaveBeenCalled();
    expect(adapter.getResult).not.toHaveBeenCalled();
    expect(adapter.listFollowups).not.toHaveBeenCalled();
    expect(adapter.getChartBrief).not.toHaveBeenCalled();
    expect(adapter.searchPatients).not.toHaveBeenCalled();
    expect(adapter.navigate).not.toHaveBeenCalled();
    for (const method of Object.values(adapter)) {
      if (typeof method === 'function') {
        expect(method).not.toHaveBeenCalled();
      }
    }
  });

  it('refuses peek and consume from a different session', () => {
    const first = makeStore({ userId: USER_A });
    first.stage(VALID_INPUT);

    const second = makeStore({ userId: USER_B });
    expectAdapterError(() => second.peek(DRAFT_ID), 'not-found');
    expectAdapterError(() => second.consume(DRAFT_ID), 'not-found');
    expect(second.diagnostics()).toEqual({ count: 0, draftIds: [] });
    expect(first.peek(DRAFT_ID).draftId).toBe(DRAFT_ID);
  });

  it('expires drafts 30 minutes after stage time', () => {
    let now = T0;
    const store = makeStore({ now: () => now });
    store.stage(VALID_INPUT);

    now = new Date(T0.getTime() + THIRTY_MINUTES_MS - 1);
    expect(store.peek(DRAFT_ID).draftId).toBe(DRAFT_ID);

    now = new Date(T0.getTime() + THIRTY_MINUTES_MS);
    expectAdapterError(() => store.peek(DRAFT_ID), 'not-found');
    expectAdapterError(() => store.consume(DRAFT_ID), 'not-found');
    expect(store.diagnostics()).toEqual({ count: 0, draftIds: [] });
  });

  it('clears every draft on logout and user change', () => {
    const store = makeStore({ userId: USER_A });
    store.stage(VALID_INPUT);
    store.logout();

    expectAdapterError(() => store.peek(DRAFT_ID), 'not-found');
    expect(store.diagnostics()).toEqual({ count: 0, draftIds: [] });

    const next = store.stage({
      ...VALID_INPUT,
      title: 'Follow up glucose',
    });
    store.userChange(USER_B);
    expectAdapterError(() => store.peek(next.draftId), 'not-found');
    expectAdapterError(() => store.consume(next.draftId), 'not-found');
    expect(store.diagnostics()).toEqual({ count: 0, draftIds: [] });
  });

  it('consumes a draft once and then treats it as missing', () => {
    const store = makeStore();
    store.stage(VALID_INPUT);

    const consumed = store.consume(DRAFT_ID);
    expect(consumed.draftId).toBe(DRAFT_ID);
    expect(consumed.title).toBe(VALID_INPUT.title);
    expectAdapterError(() => store.peek(DRAFT_ID), 'not-found');
    expectAdapterError(() => store.consume(DRAFT_ID), 'not-found');
    expectAdapterError(() => store.peek('missing-draft'), 'not-found');
  });

  it('redacts clinical content from diagnostics', () => {
    const store = makeStore();
    store.stage(VALID_INPUT);

    const diagnostics = store.diagnostics();
    const serialized = JSON.stringify(diagnostics);

    expect(diagnostics).toEqual({ count: 1, draftIds: [DRAFT_ID] });
    expect(serialized).not.toContain('Ada Lovelace');
    expect(serialized).not.toContain('patient-01');
    expect(serialized).not.toContain('potassium');
    expect(serialized).not.toContain('5.8');
    expect(serialized).not.toContain('Observation/obs-01');
    expect(serialized).not.toContain(VALID_INPUT.rationale);
    expect(serialized).not.toContain(VALID_INPUT.title);
    expect(serialized).not.toHaveProperty('patient');
    expect(Object.keys(diagnostics).sort()).toEqual(['count', 'draftIds']);
  });
});

function makeStore(
  overrides: { userId?: string; now?: () => Date; randomUUID?: () => string } = {},
): DraftStore {
  return new DraftStore({
    userId: overrides.userId ?? USER_A,
    now: overrides.now ?? (() => T0),
    randomUUID: overrides.randomUUID ?? (() => DRAFT_ID),
  });
}

function expectStageInvalid(store: DraftStore, input: ConfirmedFollowup): void {
  expectAdapterError(() => store.stage(input), 'invalid-input');
}

function expectAdapterError(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error(`expected AdapterError with code ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toMatchObject({ code });
  }
}

function fakeAdapter(): EmrAdapter {
  return {
    id: 'spy',
    getCapabilities: vi.fn(() => Promise.reject(new Error('adapter must not be called'))),
    getActivePatient: vi.fn(() => Promise.reject(new Error('adapter must not be called'))),
    searchPatients: vi.fn(() => Promise.reject(new Error('adapter must not be called'))),
    listAppointments: vi.fn(() => Promise.reject(new Error('adapter must not be called'))),
    getChartBrief: vi.fn(() => Promise.reject(new Error('adapter must not be called'))),
    listAbnormalResults: vi.fn(() => Promise.reject(new Error('adapter must not be called'))),
    getResult: vi.fn(() => Promise.reject(new Error('adapter must not be called'))),
    listFollowups: vi.fn(() => Promise.reject(new Error('adapter must not be called'))),
    listAssignees: vi.fn(() => Promise.reject(new Error('adapter must not be called'))),
    createFollowup: vi.fn(() => Promise.reject(new Error('adapter must not be called'))),
    navigate: vi.fn(() => Promise.reject(new Error('adapter must not be called'))),
  };
}
