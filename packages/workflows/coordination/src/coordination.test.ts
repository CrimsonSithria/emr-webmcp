import {
  AdapterError,
  type EmrAdapter,
  type FollowupQuery,
  type FollowupSummary,
} from '@emr-webmcp/core';
import { createFixtureAdapter } from '@emr-webmcp/contract-fixture';
import { createOpenmrsAdapter } from '@emr-webmcp/openmrs-adapter';
import { createOpenmrsMswFetch, createOpenmrsMswStore } from '@emr-webmcp/openmrs-adapter/testing';
import { describe, expect, it, vi } from 'vitest';

import { focusedReview } from './focused-review.js';
import { overdueRescue } from './overdue-rescue.js';

const FIXTURE_NOW = new Date('2026-08-31T12:00:00.000Z');
const LATER_NOW = new Date('2026-09-03T12:00:00.000Z');
const EARLIER_NOW = new Date('2026-08-10T12:00:00.000Z');

type Backend = {
  name: string;
  makeAdapter: (now?: () => Date) => EmrAdapter;
};

const backends: Backend[] = [
  {
    name: 'fixture',
    makeAdapter: (now = () => FIXTURE_NOW) => createFixtureAdapter({ now }),
  },
  {
    name: 'openmrs',
    makeAdapter: (now = () => FIXTURE_NOW) => {
      const store = createOpenmrsMswStore();
      return createOpenmrsAdapter({
        fetch: createOpenmrsMswFetch(store),
        now,
        getActivePatientId: () => store.activePatientId,
      });
    },
  },
];

describe.each(backends)('focusedReview ($name)', ({ makeAdapter }) => {
  it('reviews exactly the active patient when no patientId is provided', async () => {
    const adapter = makeAdapter();
    const writes = watchWrites(adapter);
    const result = await focusedReview(adapter);

    expect(result.patient.id).toBe('patient-01');
    expect(result.brief.patient.id).toBe('patient-01');
    expect(result.abnormalResults.every((item) => item.patient.id === 'patient-01')).toBe(true);
    expect(result.openFollowups.every((item) => item.patient.id === 'patient-01')).toBe(true);
    expect(result.abnormalResults.map((item) => item.id)).toEqual(['obs-01']);
    expect(writes).toEqual({ createFollowup: 0, navigate: 0, getActivePatient: 1 });
  });

  it('rejects a patientId that does not match the active patient', async () => {
    const adapter = makeAdapter();
    const writes = watchWrites(adapter);

    await expectAdapterError(focusedReview(adapter, { patientId: 'patient-02' }), 'invalid-input');
    expect(writes.createFollowup).toBe(0);
    expect(writes.navigate).toBe(0);
  });

  it('returns not-found when there is no active patient and no patientId', async () => {
    const adapter = withOverrides(makeAdapter(), {
      getActivePatient: () => Promise.resolve(null),
    });

    await expectAdapterError(focusedReview(adapter), 'not-found');
  });

  it('accepts an explicit patientId when it matches the active patient', async () => {
    const adapter = makeAdapter();
    const result = await focusedReview(adapter, { patientId: 'patient-01' });

    expect(result.patient.id).toBe('patient-01');
    expect(result.brief.conditions.map((item) => item.display)).toContain('Type 2 diabetes');
  });
});

describe.each(backends)('overdueRescue ($name)', ({ makeAdapter }) => {
  it('returns overdue follow-ups at the injected clock, ordered by priority then age', async () => {
    const adapter = makeAdapter();
    const writes = watchWrites(adapter);
    const result = await overdueRescue(adapter);

    expect(result.followups.every((item) => item.dueAt !== undefined)).toBe(true);
    expect(
      result.followups.every((item) => Date.parse(item.dueAt ?? '') < FIXTURE_NOW.getTime()),
    ).toBe(true);
    expect(
      result.followups.every(
        (item) => item.status === 'not-started' || item.status === 'in-progress',
      ),
    ).toBe(true);
    expect(result.followups.map((item) => item.id)).toEqual(sortedByPriorityThenAge(result.followups));
    expect(result.followups.map((item) => item.id)).toEqual(['task-01', 'task-07']);
    expect(writes.createFollowup).toBe(0);
    expect(writes.navigate).toBe(0);
  });

  it('includes newly overdue follow-ups when the clock advances', async () => {
    const adapter = makeAdapter(() => LATER_NOW);
    const result = await overdueRescue(adapter);

    expect(result.followups.map((item) => item.id)).toEqual(['task-01', 'task-03', 'task-02', 'task-07']);
  });

  it('returns no overdue follow-ups before any due date', async () => {
    const adapter = makeAdapter(() => EARLIER_NOW);
    const result = await overdueRescue(adapter);

    expect(result.followups).toEqual([]);
  });

  it('does not aggregate other patients when patientId is explicit', async () => {
    const adapter = makeAdapter();
    const writes = watchWrites(adapter);
    const result = await overdueRescue(adapter, { patientId: 'patient-01' });

    expect(result.followups.every((item) => item.patient.id === 'patient-01')).toBe(true);
    expect(result.followups.map((item) => item.id)).toEqual(['task-01']);
    expect(writes.getActivePatient).toBe(0);
  });

  it('applies explicit assignee and priority filters without inferring a patient', async () => {
    const adapter = makeAdapter();
    const writes = watchWrites(adapter);
    const result = await overdueRescue(adapter, {
      assigneeId: 'person-dr-chen',
      priority: 'high',
    });

    expect(result.followups).toHaveLength(1);
    expect(result.followups[0]?.id).toBe('task-01');
    expect(result.followups[0]?.assignee?.id).toBe('person-dr-chen');
    expect(result.followups[0]?.priority).toBe('high');
    expect(writes.getActivePatient).toBe(0);
  });

  it('always asks the adapter for overdueOnly and never passes a cursor', async () => {
    const base = makeAdapter();
    const queries: FollowupQuery[] = [];
    const adapter = withOverrides(base, {
      listFollowups: async (input) => {
        queries.push(input);
        return base.listFollowups(input);
      },
    });

    await overdueRescue(adapter, { priority: 'low' });

    expect(queries).toHaveLength(1);
    expect(queries[0]?.overdueOnly).toBe(true);
    expect(queries[0]?.priority).toBe('low');
    expect(queries[0]).not.toHaveProperty('cursor');
  });
});

function watchWrites(adapter: EmrAdapter): {
  createFollowup: number;
  navigate: number;
  getActivePatient: number;
} {
  const counts = { createFollowup: 0, navigate: 0, getActivePatient: 0 };
  const originalGetActive = adapter.getActivePatient.bind(adapter);
  vi.spyOn(adapter, 'createFollowup').mockImplementation(() => {
    counts.createFollowup += 1;
    return Promise.reject(new Error('createFollowup must not be called'));
  });
  vi.spyOn(adapter, 'navigate').mockImplementation(() => {
    counts.navigate += 1;
    return Promise.reject(new Error('navigate must not be called'));
  });
  vi.spyOn(adapter, 'getActivePatient').mockImplementation(() => {
    counts.getActivePatient += 1;
    return originalGetActive();
  });
  return counts;
}

function withOverrides(
  adapter: EmrAdapter,
  overrides: Partial<Pick<EmrAdapter, 'getActivePatient' | 'listFollowups'>>,
): EmrAdapter {
  return new Proxy(adapter, {
    get(target, property, receiver): unknown {
      if (property === 'getActivePatient' && overrides.getActivePatient !== undefined) {
        return overrides.getActivePatient;
      }
      if (property === 'listFollowups' && overrides.listFollowups !== undefined) {
        return overrides.listFollowups;
      }
      return bindIfFunction(Reflect.get(target, property, receiver), target);
    },
  });
}

function bindIfFunction(value: unknown, target: object): unknown {
  if (typeof value !== 'function') {
    return value;
  }
  const bound: unknown = Function.prototype.bind.call(value, target);
  return bound;
}

function sortedByPriorityThenAge(items: FollowupSummary[]): string[] {
  const rank = { high: 0, medium: 1, low: 2 } as const;
  return [...items]
    .sort((left, right) => {
      const byPriority = rank[left.priority] - rank[right.priority];
      if (byPriority !== 0) {
        return byPriority;
      }
      return Date.parse(left.dueAt ?? '') - Date.parse(right.dueAt ?? '');
    })
    .map((item) => item.id);
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
