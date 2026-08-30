import {
  AdapterError,
  type EmrAdapter,
  type EmrCapability,
  type EmrNavigationTarget,
  type FollowupSummary,
  type PatientRef,
  type ToolErrorCode,
} from '@emr-webmcp/core';
import { describe, expect, it } from 'vitest';

/** Seed due dates are relative to this instant. */
export const CONTRACT_NOW = new Date('2026-08-31T12:00:00.000Z');

const ALL_CAPABILITIES = [
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
] as const satisfies readonly EmrCapability[];

const SEARCH_QUERY = 'patient-';
const APPOINTMENT_START = '2026-09-01T00:00:00.000Z';
const APPOINTMENT_END = '2026-09-08T00:00:00.000Z';

export type ContractAdapterFactory = (options?: { now?: () => Date }) => EmrAdapter;

export function describeAdapterContract(makeAdapter: ContractAdapterFactory): void {
  describe('adapter contract', () => {
    const make = (): EmrAdapter => makeAdapter({ now: () => CONTRACT_NOW });

    describe('capability reporting', () => {
      it('advertises every required capability', async () => {
        const capabilities = await make().getCapabilities();

        expect(capabilities).toBeInstanceOf(Set);
        expect([...capabilities].sort()).toEqual([...ALL_CAPABILITIES].sort());
      });
    });

    describe('searchPatients', () => {
      it('rejects an empty query as invalid-input', async () => {
        await expectAdapterError(make().searchPatients('', 10), 'invalid-input');
        await expectAdapterError(make().searchPatients('   ', 10), 'invalid-input');
      });

      it('rejects a limit below 1 as invalid-input', async () => {
        await expectAdapterError(make().searchPatients(SEARCH_QUERY, 0), 'invalid-input');
        await expectAdapterError(make().searchPatients(SEARCH_QUERY, -1), 'invalid-input');
      });

      it('caps results at min(limit, 20)', async () => {
        const adapter = make();
        const limited = await adapter.searchPatients(SEARCH_QUERY, 3);
        const uncappedRequest = await adapter.searchPatients(SEARCH_QUERY, 100);

        expect(limited.length).toBeGreaterThan(0);
        expect(limited.length).toBeLessThanOrEqual(3);
        expect(uncappedRequest.length).toBeGreaterThan(limited.length);
        expect(uncappedRequest.length).toBeLessThanOrEqual(20);
      });
    });

    describe('listAppointments', () => {
      it('rejects missing start or end as invalid-input', async () => {
        const adapter = make();

        await expectAdapterError(
          adapter.listAppointments({ start: APPOINTMENT_START } as { start: string; end: string }),
          'invalid-input',
        );
        await expectAdapterError(
          adapter.listAppointments({ end: APPOINTMENT_END } as { start: string; end: string }),
          'invalid-input',
        );
        await expectAdapterError(
          adapter.listAppointments({ start: '', end: APPOINTMENT_END }),
          'invalid-input',
        );
      });

      it('rejects a window longer than 7 days as invalid-input', async () => {
        await expectAdapterError(
          make().listAppointments({
            start: APPOINTMENT_START,
            end: '2026-09-08T00:00:00.001Z',
          }),
          'invalid-input',
        );
      });

      it('returns appointments inside a 7-day window', async () => {
        const appointments = await make().listAppointments({
          start: APPOINTMENT_START,
          end: APPOINTMENT_END,
        });

        expect(appointments.length).toBeGreaterThan(0);
        expect(
          appointments.every(
            (appointment) =>
              appointment.start >= APPOINTMENT_START && appointment.start <= APPOINTMENT_END,
          ),
        ).toBe(true);
      });
    });

    describe('listAbnormalResults', () => {
      it('returns only interpretations that are not normal or unknown', async () => {
        const results = await make().listAbnormalResults({ limit: 100 });

        expect(results.length).toBeGreaterThan(0);
        expect(
          results.every(
            (result) => result.interpretation !== 'normal' && result.interpretation !== 'unknown',
          ),
        ).toBe(true);
      });

      it('caps results at min(limit, 100)', async () => {
        const adapter = make();
        const limited = await adapter.listAbnormalResults({ limit: 1 });
        const uncappedRequest = await adapter.listAbnormalResults({ limit: 1000 });

        expect(limited).toHaveLength(1);
        expect(uncappedRequest.length).toBeGreaterThan(1);
        expect(uncappedRequest.length).toBeLessThanOrEqual(100);
      });
    });

    describe('listFollowups', () => {
      it('filters by patientId, assigneeId, priority, and overdueOnly', async () => {
        const adapter = make();
        const all = await adapter.listFollowups({ limit: 100 });
        expect(all.length).toBeGreaterThan(1);

        const withAssignee = all.find((item) => item.assignee !== undefined);
        expect(withAssignee?.assignee).toBeDefined();
        if (withAssignee?.assignee === undefined) {
          throw new Error('expected a follow-up with an assignee');
        }

        const byPatient = await adapter.listFollowups({
          limit: 100,
          patientId: withAssignee.patient.id,
        });
        expect(byPatient.length).toBeGreaterThan(0);
        expect(byPatient.every((item) => item.patient.id === withAssignee.patient.id)).toBe(true);
        expect(byPatient.length).toBeLessThan(all.length);

        const byAssignee = await adapter.listFollowups({
          limit: 100,
          assigneeId: withAssignee.assignee.id,
        });
        expect(byAssignee.length).toBeGreaterThan(0);
        expect(byAssignee.every((item) => item.assignee?.id === withAssignee.assignee?.id)).toBe(
          true,
        );

        const byPriority = await adapter.listFollowups({ limit: 100, priority: 'high' });
        expect(byPriority.length).toBeGreaterThan(0);
        expect(byPriority.every((item) => item.priority === 'high')).toBe(true);
        expect(byPriority.length).toBeLessThan(all.length);

        const overdue = await adapter.listFollowups({ limit: 100, overdueOnly: true });
        expect(overdue.length).toBeGreaterThan(0);
        expect(overdue.length).toBeLessThan(all.length);
        for (const item of overdue) {
          expect(item.dueAt).toBeDefined();
          if (item.dueAt === undefined) {
            throw new Error('expected overdue follow-up to have dueAt');
          }
          expect(Date.parse(item.dueAt)).toBeLessThan(CONTRACT_NOW.getTime());
        }
      });
    });

    describe('getChartBrief and getResult', () => {
      it('returns a chart brief for an existing patient', async () => {
        const adapter = make();
        const patient = await requirePatient(adapter);
        const brief = await adapter.getChartBrief(patient.id);

        expect(brief.patient).toEqual(patient);
        expect(Array.isArray(brief.conditions)).toBe(true);
        expect(Array.isArray(brief.allergies)).toBe(true);
        expect(Array.isArray(brief.medications)).toBe(true);
        expect(Array.isArray(brief.recentVitals)).toBe(true);
        expect(Array.isArray(brief.recentResults)).toBe(true);
        expect(Array.isArray(brief.openTasks)).toBe(true);
      });

      it('throws not-found when the patient is missing', async () => {
        await expectAdapterError(make().getChartBrief('missing-patient'), 'not-found');
      });

      it('returns a result by id and throws not-found when missing', async () => {
        const adapter = make();
        const [abnormal] = await adapter.listAbnormalResults({ limit: 1 });
        expect(abnormal).toBeDefined();
        if (abnormal === undefined) {
          throw new Error('expected an abnormal result');
        }

        await expect(adapter.getResult(abnormal.id)).resolves.toEqual(abnormal);
        await expectAdapterError(adapter.getResult('missing-result'), 'not-found');
      });
    });

    describe('navigate', () => {
      it('accepts known targets and rejects unknown or invalid targets', async () => {
        const adapter = make();
        const patient = await requirePatient(adapter);
        const followups = await adapter.listFollowups({ limit: 1 });
        const taskId = followups[0]?.id ?? 'task-workspace-probe';

        await expect(adapter.navigate({ kind: 'review-queue' })).resolves.toBeUndefined();
        await expect(
          adapter.navigate({ kind: 'patient-chart', patientId: patient.id }),
        ).resolves.toBeUndefined();
        await expect(adapter.navigate({ kind: 'tests-dashboard' })).resolves.toBeUndefined();
        await expect(adapter.navigate({ kind: 'task-workspace', taskId })).resolves.toBeUndefined();

        await expectAdapterError(
          adapter.navigate({ kind: 'unknown-place' } as unknown as EmrNavigationTarget),
          'invalid-input',
        );
        await expectAdapterError(
          adapter.navigate({ kind: 'patient-chart', patientId: '' }),
          'invalid-input',
        );
        await expectAdapterError(
          adapter.navigate({ kind: 'task-workspace', taskId: '' }),
          'invalid-input',
        );
      });
    });

    describe('createFollowup', () => {
      it('conflicts when an active follow-up already has the same sourceReference', async () => {
        const adapter = make();
        const patient = await requirePatient(adapter);
        const input = {
          patient,
          title: 'Contract duplicate source',
          rationale: 'First write for the isolation-safe conflict probe.',
          priority: 'high' as const,
          sourceReference: 'Observation/obs-contract-dup',
        };

        const created = await adapter.createFollowup(input);
        expect(created.sourceReference).toBe(input.sourceReference);
        expect(created.status === 'not-started' || created.status === 'in-progress').toBe(true);

        await expectAdapterError(adapter.createFollowup(input), 'conflict');
      });

      it('does not block a new follow-up after completed or cancelled sourceReferences', async () => {
        const adapter = make();
        const followups = await adapter.listFollowups({ limit: 100 });
        const completed = requireFollowupWithStatus(followups, 'completed');
        const cancelled = requireFollowupWithStatus(followups, 'cancelled');

        const afterCompleted = await adapter.createFollowup({
          patient: completed.patient,
          title: 'Reuse completed source',
          rationale: 'Completed tasks must not block a new follow-up.',
          priority: 'medium',
          sourceReference: completed.sourceReference,
        });
        expect(afterCompleted.sourceReference).toBe(completed.sourceReference);

        const afterCancelled = await adapter.createFollowup({
          patient: cancelled.patient,
          title: 'Reuse cancelled source',
          rationale: 'Cancelled tasks must not block a new follow-up.',
          priority: 'medium',
          sourceReference: cancelled.sourceReference,
        });
        expect(afterCancelled.sourceReference).toBe(cancelled.sourceReference);
      });

      it('keeps mutations on the adapter instance', async () => {
        const first = make();
        const second = make();
        const patient = await requirePatient(first);

        await first.createFollowup({
          patient,
          title: 'Isolation write',
          rationale: 'Must not appear on a sibling adapter instance.',
          priority: 'low',
          sourceReference: 'Observation/obs-isolation-write',
        });

        const firstList = await first.listFollowups({ limit: 100 });
        const secondList = await second.listFollowups({ limit: 100 });

        expect(
          firstList.some((item) => item.sourceReference === 'Observation/obs-isolation-write'),
        ).toBe(true);
        expect(
          secondList.some((item) => item.sourceReference === 'Observation/obs-isolation-write'),
        ).toBe(false);
      });
    });
  });
}

async function requirePatient(adapter: EmrAdapter): Promise<PatientRef> {
  const patients = await adapter.searchPatients(SEARCH_QUERY, 20);
  const patient = patients[0];
  expect(patient).toBeDefined();
  if (patient === undefined) {
    throw new Error('expected a searchable patient');
  }
  return patient;
}

function requireFollowupWithStatus(
  followups: readonly FollowupSummary[],
  status: 'completed' | 'cancelled',
): FollowupSummary & { sourceReference: string } {
  const match = followups.find(
    (item) => item.status === status && item.sourceReference !== undefined,
  );
  expect(match?.sourceReference).toBeDefined();
  if (match?.sourceReference === undefined) {
    throw new Error(`expected a ${status} follow-up with sourceReference`);
  }
  return { ...match, sourceReference: match.sourceReference };
}

async function expectAdapterError(action: Promise<unknown>, code: ToolErrorCode): Promise<void> {
  try {
    await action;
    throw new Error(`expected AdapterError with code ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toMatchObject({ code });
  }
}
