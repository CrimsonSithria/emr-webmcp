import { describe, expect, it } from 'vitest';

import type { EmrAdapter } from './adapter.js';
import type { EmrCapability, EmrNavigationTarget } from './capabilities.js';
import type {
  AssigneeSummary,
  AppointmentSummary,
  ChartBrief,
  ConfirmedFollowup,
  FollowupDraft,
  FollowupSummary,
  PatientRef,
  ResultSummary,
} from './dtos.js';
import type { AppointmentQuery, FollowupQuery, ResultQuery } from './queries.js';
import { errorResult, successResult, type ToolResult } from './tool-result.js';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
type Expect<T extends true> = T;

const ERROR_CODES = [
  'unauthorized',
  'unsupported',
  'not-found',
  'invalid-input',
  'conflict',
  'upstream',
] as const;

const CAPABILITIES = [
  'search-patients',
  'list-appointments',
  'get-chart-brief',
  'list-abnormal-results',
  'get-result',
  'list-followups',
  'list-assignees',
  'create-followup',
  'navigate-patient-chart',
  'navigate-tests',
  'navigate-tasks',
  'navigate-review-queue',
] as const;

const APPOINTMENT_STATUSES = [
  'scheduled',
  'checked-in',
  'completed',
  'cancelled',
  'unknown',
] as const;

const RESULT_INTERPRETATIONS = [
  'critical-low',
  'low',
  'normal',
  'high',
  'critical-high',
  'unknown',
] as const;

const FOLLOWUP_STATUSES = [
  'not-started',
  'in-progress',
  'completed',
  'cancelled',
  'unknown',
] as const;

const PRIORITIES = ['low', 'medium', 'high'] as const;

const FORBIDDEN_PUBLIC_KEYS = [
  'raw',
  'payload',
  'resource',
  'fhir',
  'openmrs',
  'body',
  'stack',
  'credentials',
] as const;

const ada: PatientRef = {
  id: 'patient-ada',
  display: 'Ada Lovelace',
};

const assignee: AssigneeSummary = {
  id: 'role-nurse',
  display: 'Clinic nurse',
  type: 'role',
};

const appointment: AppointmentSummary = {
  id: 'appt-1',
  patient: ada,
  start: '2026-09-01T09:00:00.000Z',
  status: 'scheduled',
};

const potassium: ResultSummary = {
  id: 'obs-1',
  patient: ada,
  name: 'Potassium',
  observedAt: '2026-08-30T12:00:00.000Z',
  interpretation: 'high',
  sourceReference: 'Observation/obs-1',
};

const followup: FollowupSummary = {
  id: 'task-1',
  patient: ada,
  title: 'Follow up potassium',
  status: 'not-started',
  priority: 'high',
};

const draft: FollowupDraft = {
  draftId: 'draft-1',
  patient: ada,
  title: 'Follow up potassium',
  rationale: 'Recorded high potassium has no active task.',
  priority: 'high',
};

const chartBrief: ChartBrief = {
  patient: ada,
  conditions: [{ id: 'cond-1', display: 'Type 2 diabetes' }],
  allergies: [{ id: 'alg-1', display: 'Penicillin' }],
  medications: [{ id: 'med-1', display: 'Metformin' }],
  recentVitals: [potassium],
  recentResults: [potassium],
  openTasks: [followup],
};

const confirmed: ConfirmedFollowup = {
  patient: ada,
  title: 'Follow up potassium',
  rationale: 'Recorded high potassium has no active task.',
  priority: 'high',
};

const appointmentQuery: AppointmentQuery = {
  start: '2026-09-01T00:00:00.000Z',
  end: '2026-09-07T23:59:59.000Z',
};

const resultQuery: ResultQuery = {
  limit: 100,
};

const followupQuery: FollowupQuery = {
  limit: 50,
};

const deps = {
  randomUUID: () => '11111111-1111-4111-8111-111111111111',
  now: () => new Date('2026-08-31T02:55:00.000Z'),
  adapterId: 'core-test',
};

const adapter: EmrAdapter = {
  id: 'core-test',
  getCapabilities: () => Promise.resolve(new Set<EmrCapability>(CAPABILITIES)),
  getActivePatient: () => Promise.resolve(ada),
  searchPatients: () => Promise.resolve([ada]),
  listAppointments: () => Promise.resolve([appointment]),
  getChartBrief: () => Promise.resolve(chartBrief),
  listAbnormalResults: () => Promise.resolve([potassium]),
  getResult: () => Promise.resolve(potassium),
  listFollowups: () => Promise.resolve([followup]),
  listAssignees: () => Promise.resolve([assignee]),
  createFollowup: () => Promise.resolve(followup),
  navigate: () => Promise.resolve(),
};

function parseJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function keysOf(value: object): string[] {
  return Object.keys(value).sort();
}

function assertNoForbiddenKeys(value: object): void {
  for (const key of FORBIDDEN_PUBLIC_KEYS) {
    expect(Object.hasOwn(value, key)).toBe(false);
  }
}

function assertRequiredMeta(meta: ToolResult<unknown>['meta']): void {
  expect(meta.invocationId).toBe('11111111-1111-4111-8111-111111111111');
  expect(meta.adapterId).toBe('core-test');
  expect(meta.generatedAt).toBe('2026-08-31T02:55:00.000Z');
  expect(meta.truncated).toBeTypeOf('boolean');
}

describe('compile-time contract', () => {
  it('locks every DTO, query, union, adapter method, and error code', () => {
    type ErrorInput = Parameters<typeof errorResult>[1];
    type Deps = Parameters<typeof successResult>[0];
    type RequiredMeta = Omit<ToolResult<unknown>['meta'], 'nextCursor'>;

    const checks: [
      Expect<Equal<PatientRef, { id: string; display: string }>>,
      Expect<
        Equal<
          AppointmentSummary,
          {
            id: string;
            patient: PatientRef;
            start: string;
            status: 'scheduled' | 'checked-in' | 'completed' | 'cancelled' | 'unknown';
            service?: string;
          }
        >
      >,
      Expect<
        Equal<
          ResultSummary,
          {
            id: string;
            patient: PatientRef;
            name: string;
            value?: string;
            unit?: string;
            observedAt: string;
            interpretation: 'critical-low' | 'low' | 'normal' | 'high' | 'critical-high' | 'unknown';
            referenceRange?: string;
            sourceReference: string;
          }
        >
      >,
      Expect<
        Equal<
          FollowupSummary,
          {
            id: string;
            patient: PatientRef;
            title: string;
            status: 'not-started' | 'in-progress' | 'completed' | 'cancelled' | 'unknown';
            priority: 'low' | 'medium' | 'high';
            dueAt?: string;
            assignee?: { id: string; display: string; type: 'person' | 'role' };
            sourceReference?: string;
          }
        >
      >,
      Expect<
        Equal<
          FollowupDraft,
          {
            draftId: string;
            patient: PatientRef;
            title: string;
            rationale: string;
            priority: 'low' | 'medium' | 'high';
            dueAt?: string;
            assignee?: { id: string; display: string; type: 'person' | 'role' };
            sourceReference?: string;
          }
        >
      >,
      Expect<
        Equal<
          ChartBrief,
          {
            patient: PatientRef;
            conditions: ReadonlyArray<{ id: string; display: string }>;
            allergies: ReadonlyArray<{ id: string; display: string }>;
            medications: ReadonlyArray<{ id: string; display: string }>;
            recentVitals: ReadonlyArray<ResultSummary>;
            recentResults: ReadonlyArray<ResultSummary>;
            openTasks: ReadonlyArray<FollowupSummary>;
          }
        >
      >,
      Expect<
        Equal<AssigneeSummary, { id: string; display: string; type: 'person' | 'role' }>
      >,
      Expect<
        Equal<
          ConfirmedFollowup,
          {
            patient: PatientRef;
            title: string;
            rationale: string;
            priority: 'low' | 'medium' | 'high';
            dueAt?: string;
            assignee?: AssigneeSummary;
            sourceReference?: string;
          }
        >
      >,
      Expect<Equal<AppointmentQuery, { start: string; end: string }>>,
      Expect<
        Equal<ResultQuery, { limit: number; patientId?: string; cursor?: string }>
      >,
      Expect<
        Equal<
          FollowupQuery,
          {
            limit: number;
            patientId?: string;
            assigneeId?: string;
            priority?: 'low' | 'medium' | 'high';
            overdueOnly?: boolean;
            cursor?: string;
          }
        >
      >,
      Expect<
        Equal<
          EmrNavigationTarget,
          | { kind: 'patient-chart'; patientId: string }
          | { kind: 'tests-dashboard'; patientId?: string }
          | { kind: 'task-workspace'; taskId: string }
          | { kind: 'review-queue' }
        >
      >,
      Expect<Equal<EmrCapability, (typeof CAPABILITIES)[number]>>,
      Expect<Equal<AppointmentSummary['status'], (typeof APPOINTMENT_STATUSES)[number]>>,
      Expect<Equal<ResultSummary['interpretation'], (typeof RESULT_INTERPRETATIONS)[number]>>,
      Expect<Equal<FollowupSummary['status'], (typeof FOLLOWUP_STATUSES)[number]>>,
      Expect<Equal<FollowupSummary['priority'], (typeof PRIORITIES)[number]>>,
      Expect<Equal<NonNullable<FollowupSummary['assignee']>, AssigneeSummary>>,
      Expect<Equal<EmrAdapter['id'], string>>,
      Expect<Equal<keyof EmrAdapter, 'id' | EmrAdapterMethod>>,
      Expect<Equal<Parameters<EmrAdapter['getCapabilities']>, []>>,
      Expect<
        Equal<ReturnType<EmrAdapter['getCapabilities']>, Promise<ReadonlySet<EmrCapability>>>
      >,
      Expect<Equal<ReturnType<EmrAdapter['getActivePatient']>, Promise<PatientRef | null>>>,
      Expect<Equal<Parameters<EmrAdapter['searchPatients']>, [query: string, limit: number]>>,
      Expect<Equal<ReturnType<EmrAdapter['searchPatients']>, Promise<PatientRef[]>>>,
      Expect<Equal<Parameters<EmrAdapter['listAppointments']>, [input: AppointmentQuery]>>,
      Expect<Equal<ReturnType<EmrAdapter['listAppointments']>, Promise<AppointmentSummary[]>>>,
      Expect<Equal<Parameters<EmrAdapter['getChartBrief']>, [patientId: string]>>,
      Expect<Equal<ReturnType<EmrAdapter['getChartBrief']>, Promise<ChartBrief>>>,
      Expect<Equal<Parameters<EmrAdapter['listAbnormalResults']>, [input: ResultQuery]>>,
      Expect<Equal<ReturnType<EmrAdapter['listAbnormalResults']>, Promise<ResultSummary[]>>>,
      Expect<Equal<Parameters<EmrAdapter['getResult']>, [resultId: string]>>,
      Expect<Equal<ReturnType<EmrAdapter['getResult']>, Promise<ResultSummary>>>,
      Expect<Equal<Parameters<EmrAdapter['listFollowups']>, [input: FollowupQuery]>>,
      Expect<Equal<ReturnType<EmrAdapter['listFollowups']>, Promise<FollowupSummary[]>>>,
      Expect<Equal<Parameters<EmrAdapter['listAssignees']>, [query: string, limit: number]>>,
      Expect<Equal<ReturnType<EmrAdapter['listAssignees']>, Promise<AssigneeSummary[]>>>,
      Expect<Equal<Parameters<EmrAdapter['createFollowup']>, [input: ConfirmedFollowup]>>,
      Expect<Equal<ReturnType<EmrAdapter['createFollowup']>, Promise<FollowupSummary>>>,
      Expect<Equal<Parameters<EmrAdapter['navigate']>, [target: EmrNavigationTarget]>>,
      Expect<Equal<ReturnType<EmrAdapter['navigate']>, Promise<void>>>,
      Expect<
        Equal<
          NonNullable<ToolResult<unknown>['error']>['code'],
          (typeof ERROR_CODES)[number]
        >
      >,
      Expect<
        Equal<keyof RequiredMeta, 'invocationId' | 'adapterId' | 'generatedAt' | 'truncated'>
      >,
      Expect<Equal<keyof Deps, 'randomUUID' | 'now' | 'adapterId'>>,
      Expect<Equal<keyof ErrorInput, 'code' | 'message' | 'retryable'>>,
    ] = [
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ];

    type EmrAdapterMethod =
      | 'getCapabilities'
      | 'getActivePatient'
      | 'searchPatients'
      | 'listAppointments'
      | 'getChartBrief'
      | 'listAbnormalResults'
      | 'getResult'
      | 'listFollowups'
      | 'listAssignees'
      | 'createFollowup'
      | 'navigate';

    expect(checks.every((flag) => flag === true)).toBe(true);
  });
});

describe('serializable public DTOs', () => {
  it.each([
    ['PatientRef', ada, ['display', 'id']],
    ['AppointmentSummary', appointment, ['id', 'patient', 'start', 'status']],
    ['ResultSummary', potassium, ['id', 'interpretation', 'name', 'observedAt', 'patient', 'sourceReference']],
    ['FollowupSummary', followup, ['id', 'patient', 'priority', 'status', 'title']],
    ['FollowupDraft', draft, ['draftId', 'patient', 'priority', 'rationale', 'title']],
    [
      'ChartBrief',
      chartBrief,
      ['allergies', 'conditions', 'medications', 'openTasks', 'patient', 'recentResults', 'recentVitals'],
    ],
    ['AssigneeSummary', assignee, ['display', 'id', 'type']],
    ['ConfirmedFollowup', confirmed, ['patient', 'priority', 'rationale', 'title']],
    ['AppointmentQuery', appointmentQuery, ['end', 'start']],
    ['ResultQuery', resultQuery, ['limit']],
    ['FollowupQuery', followupQuery, ['limit']],
  ] as const)('round-trips %s without raw upstream fields', (_name, value, requiredKeys) => {
    assertNoForbiddenKeys(value);
    const parsed = parseJson(value);
    expect(parsed).toEqual(value);
    expect(keysOf(value)).toEqual([...requiredKeys]);
  });

  it('omits optional DTO keys instead of sending undefined', () => {
    expect(Object.hasOwn(appointment, 'service')).toBe(false);
    expect(Object.hasOwn(potassium, 'value')).toBe(false);
    expect(Object.hasOwn(potassium, 'unit')).toBe(false);
    expect(Object.hasOwn(potassium, 'referenceRange')).toBe(false);
    expect(Object.hasOwn(followup, 'dueAt')).toBe(false);
    expect(Object.hasOwn(followup, 'assignee')).toBe(false);
    expect(Object.hasOwn(followup, 'sourceReference')).toBe(false);
    expect(Object.hasOwn(resultQuery, 'patientId')).toBe(false);
    expect(Object.hasOwn(resultQuery, 'cursor')).toBe(false);
    expect(Object.hasOwn(followupQuery, 'priority')).toBe(false);
    expect(Object.hasOwn(followupQuery, 'overdueOnly')).toBe(false);
  });

  it('accepts every appointment status, result interpretation, and follow-up status', () => {
    const statuses: AppointmentSummary['status'][] = [...APPOINTMENT_STATUSES];
    const interpretations: ResultSummary['interpretation'][] = [...RESULT_INTERPRETATIONS];
    const followupStatuses: FollowupSummary['status'][] = [...FOLLOWUP_STATUSES];
    const priorities: FollowupSummary['priority'][] = [...PRIORITIES];

    expect(statuses).toHaveLength(5);
    expect(interpretations).toHaveLength(6);
    expect(followupStatuses).toHaveLength(5);
    expect(priorities).toHaveLength(3);
  });
});

describe('EmrNavigationTarget and EmrCapability', () => {
  it('covers every navigation target kind', () => {
    const targets: EmrNavigationTarget[] = [
      { kind: 'patient-chart', patientId: ada.id },
      { kind: 'tests-dashboard' },
      { kind: 'tests-dashboard', patientId: ada.id },
      { kind: 'task-workspace', taskId: followup.id },
      { kind: 'review-queue' },
    ];

    const kinds = targets.map((target) => {
      switch (target.kind) {
        case 'patient-chart':
          return target.patientId;
        case 'tests-dashboard':
          return target.patientId ?? 'all-tests';
        case 'task-workspace':
          return target.taskId;
        case 'review-queue':
          return target.kind;
        default: {
          const exhaustive: never = target;
          return exhaustive;
        }
      }
    });

    expect(kinds).toEqual([ada.id, 'all-tests', ada.id, followup.id, 'review-queue']);
    expect(Object.hasOwn(targets[1] as object, 'patientId')).toBe(false);
  });

  it('enumerates all twelve adapter capabilities', () => {
    expect(CAPABILITIES).toHaveLength(12);
    const advertised: EmrCapability[] = [...CAPABILITIES];
    expect(advertised).toEqual([...CAPABILITIES]);
  });
});

describe('EmrAdapter', () => {
  it('exposes the complete interface as a callable object', async () => {
    await expect(adapter.getCapabilities()).resolves.toEqual(new Set(CAPABILITIES));
    await expect(adapter.getActivePatient()).resolves.toEqual(ada);
    await expect(adapter.searchPatients('Ada', 20)).resolves.toEqual([ada]);
    await expect(adapter.listAppointments(appointmentQuery)).resolves.toEqual([appointment]);
    await expect(adapter.getChartBrief(ada.id)).resolves.toEqual(chartBrief);
    await expect(adapter.listAbnormalResults(resultQuery)).resolves.toEqual([potassium]);
    await expect(adapter.getResult(potassium.id)).resolves.toEqual(potassium);
    await expect(adapter.listFollowups(followupQuery)).resolves.toEqual([followup]);
    await expect(adapter.listAssignees('nurse', 20)).resolves.toEqual([assignee]);
    await expect(adapter.createFollowup(confirmed)).resolves.toEqual(followup);
    await expect(adapter.navigate({ kind: 'review-queue' })).resolves.toBeUndefined();
    expect(adapter.id).toBe('core-test');
  });
});

describe('ToolResult factories', () => {
  it('serializes success meta with every required field', () => {
    const result = successResult(deps, ada);
    const parsed = parseJson(result) as ToolResult<PatientRef>;

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(ada);
    expect(Object.hasOwn(result, 'error')).toBe(false);
    expect(Object.hasOwn(result.meta, 'nextCursor')).toBe(false);
    expect(result.meta.truncated).toBe(false);
    assertRequiredMeta(result.meta);

    expect(parsed.ok).toBe(true);
    expect(parsed.data).toEqual(ada);
    expect(Object.hasOwn(parsed, 'error')).toBe(false);
    expect(keysOf(parsed.meta)).toEqual([
      'adapterId',
      'generatedAt',
      'invocationId',
      'truncated',
    ]);
    assertRequiredMeta(parsed.meta);
  });

  it('includes nextCursor only when the caller supplies one', () => {
    const result = successResult(deps, [potassium], {
      truncated: true,
      nextCursor: 'cursor-2',
    });

    expect(result.meta.truncated).toBe(true);
    expect(result.meta.nextCursor).toBe('cursor-2');
    expect(keysOf(parseJson(result.meta) as object)).toEqual([
      'adapterId',
      'generatedAt',
      'invocationId',
      'nextCursor',
      'truncated',
    ]);
  });

  it.each(ERROR_CODES)('serializes %s errors with a public message and complete meta', (code) => {
    const result = errorResult(deps, {
      code,
      message: 'The requested follow-up was not found.',
      retryable: code === 'upstream',
    });
    const parsed = parseJson(result) as ToolResult<never>;

    expect(result.ok).toBe(false);
    expect(Object.hasOwn(result, 'data')).toBe(false);
    expect(result.error).toEqual({
      code,
      message: 'The requested follow-up was not found.',
      retryable: code === 'upstream',
    });
    if (result.error === undefined) {
      throw new Error('expected ToolResult.error');
    }
    expect(keysOf(result.error)).toEqual(['code', 'message', 'retryable']);
    assertRequiredMeta(result.meta);
    expect(Object.hasOwn(result.meta, 'nextCursor')).toBe(false);

    expect(parsed.ok).toBe(false);
    expect(Object.hasOwn(parsed, 'data')).toBe(false);
    expect(parsed.error).toEqual(result.error);
    expect(keysOf(parsed.meta)).toEqual([
      'adapterId',
      'generatedAt',
      'invocationId',
      'truncated',
    ]);
    assertRequiredMeta(parsed.meta);
    assertNoForbiddenKeys(parsed.error as object);
  });

  it('uses injected randomUUID and now instead of ambient clocks', () => {
    const first = successResult(deps, ada);
    const second = errorResult(
      {
        randomUUID: () => '22222222-2222-4222-8222-222222222222',
        now: () => new Date('2026-08-31T03:00:00.000Z'),
        adapterId: 'other-adapter',
      },
      {
        code: 'conflict',
        message: 'An active follow-up already exists for this source.',
        retryable: false,
      },
    );

    expect(first.meta.invocationId).toBe('11111111-1111-4111-8111-111111111111');
    expect(first.meta.generatedAt).toBe('2026-08-31T02:55:00.000Z');
    expect(second.meta.invocationId).toBe('22222222-2222-4222-8222-222222222222');
    expect(second.meta.generatedAt).toBe('2026-08-31T03:00:00.000Z');
    expect(second.meta.adapterId).toBe('other-adapter');
  });
});
