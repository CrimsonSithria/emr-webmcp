import {
  AdapterError,
  type AppointmentQuery,
  type AppointmentSummary,
  type AssigneeSummary,
  type ChartBrief,
  type ConfirmedFollowup,
  type EmrAdapter,
  type EmrCapability,
  type EmrNavigationTarget,
  type FollowupQuery,
  type FollowupSummary,
  type PatientRef,
  type ResultQuery,
  type ResultSummary,
} from '@emr-webmcp/core';

import { createFixtureStore, FIXTURE_NOW_ISO, type FixtureStore } from './fixture-data.js';

const ALL_CAPABILITIES: readonly EmrCapability[] = [
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
];

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export type FixtureAdapterOptions = {
  now?: () => Date;
};

export type FixtureAdapter = EmrAdapter & {
  readonly recordedNavigations: readonly EmrNavigationTarget[];
};

export function createFixtureAdapter(options?: FixtureAdapterOptions): FixtureAdapter {
  return new FixtureAdapterImpl(options?.now ?? (() => new Date(FIXTURE_NOW_ISO)));
}

class FixtureAdapterImpl implements FixtureAdapter {
  readonly id = 'contract-fixture';
  private readonly store: FixtureStore;
  private readonly now: () => Date;
  private readonly navigations: EmrNavigationTarget[] = [];
  private nextCreatedId = 1;

  constructor(now: () => Date) {
    this.store = createFixtureStore();
    this.now = now;
  }

  get recordedNavigations(): readonly EmrNavigationTarget[] {
    return this.navigations;
  }

  getCapabilities(): Promise<ReadonlySet<EmrCapability>> {
    return this.run(() => new Set(ALL_CAPABILITIES));
  }

  getActivePatient(): Promise<PatientRef | null> {
    return this.run(() => {
      if (this.store.activePatientId === null) {
        return null;
      }
      const patient = this.store.patients.find((item) => item.id === this.store.activePatientId);
      return patient === undefined ? null : clone(patient);
    });
  }

  searchPatients(query: string, limit: number): Promise<PatientRef[]> {
    return this.run(() => {
      const needle = query.trim().toLowerCase();
      if (needle === '') {
        throw invalidInput('Search query must be non-empty.');
      }
      if (limit < 1) {
        throw invalidInput('Search limit must be at least 1.');
      }

      const matches = this.store.patients.filter(
        (patient) =>
          patient.id.toLowerCase().includes(needle) ||
          patient.display.toLowerCase().includes(needle),
      );
      return matches.slice(0, Math.min(limit, 20)).map(clone);
    });
  }

  listAppointments(input: AppointmentQuery): Promise<AppointmentSummary[]> {
    return this.run(() => {
      const start = input.start;
      const end = input.end;
      if (
        typeof start !== 'string' ||
        start.trim() === '' ||
        typeof end !== 'string' ||
        end.trim() === ''
      ) {
        throw invalidInput('Appointment window start and end are required.');
      }

      const startMs = Date.parse(start);
      const endMs = Date.parse(end);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
        throw invalidInput('Appointment window start and end are required.');
      }
      if (endMs - startMs > SEVEN_DAYS_MS) {
        throw invalidInput('Appointment window cannot exceed 7 days.');
      }

      return this.store.appointments
        .filter((appointment) => {
          const at = Date.parse(appointment.start);
          return Number.isFinite(at) && at >= startMs && at <= endMs;
        })
        .map(clone);
    });
  }

  getChartBrief(patientId: string): Promise<ChartBrief> {
    return this.run(() => {
      const patient = this.store.patients.find((item) => item.id === patientId);
      const extras = this.store.charts[patientId];
      if (patient === undefined || extras === undefined) {
        throw notFound('Patient was not found.');
      }

      const openTasks = this.store.followups.filter(
        (item) =>
          item.patient.id === patientId &&
          (item.status === 'not-started' || item.status === 'in-progress'),
      );
      const recentVitals = this.store.results.filter(
        (item) => item.patient.id === patientId && this.store.vitalIds.includes(item.id),
      );
      const recentResults = this.store.results.filter(
        (item) => item.patient.id === patientId && !this.store.vitalIds.includes(item.id),
      );

      return clone({
        patient,
        conditions: extras.conditions,
        allergies: extras.allergies,
        medications: extras.medications,
        recentVitals,
        recentResults,
        openTasks,
      });
    });
  }

  listAbnormalResults(input: ResultQuery): Promise<ResultSummary[]> {
    return this.run(() => {
      const matches = this.store.results.filter((item) => {
        if (item.interpretation === 'normal' || item.interpretation === 'unknown') {
          return false;
        }
        return input.patientId === undefined || item.patient.id === input.patientId;
      });
      return matches.slice(0, Math.max(0, Math.min(input.limit, 100))).map(clone);
    });
  }

  getResult(resultId: string): Promise<ResultSummary> {
    return this.run(() => {
      const result = this.store.results.find((item) => item.id === resultId);
      if (result === undefined) {
        throw notFound('Result was not found.');
      }
      return clone(result);
    });
  }

  listFollowups(input: FollowupQuery): Promise<FollowupSummary[]> {
    return this.run(() => {
      const nowMs = this.now().getTime();
      const matches = this.store.followups.filter((item) => {
        if (input.patientId !== undefined && item.patient.id !== input.patientId) {
          return false;
        }
        if (input.assigneeId !== undefined && item.assignee?.id !== input.assigneeId) {
          return false;
        }
        if (input.priority !== undefined && item.priority !== input.priority) {
          return false;
        }
        if (input.overdueOnly === true) {
          if (item.dueAt === undefined) {
            return false;
          }
          return Date.parse(item.dueAt) < nowMs;
        }
        return true;
      });
      return matches.slice(0, Math.max(0, input.limit)).map(clone);
    });
  }

  listAssignees(query: string, limit: number): Promise<AssigneeSummary[]> {
    return this.run(() => {
      const needle = query.trim().toLowerCase();
      const matches =
        needle === ''
          ? this.store.assignees
          : this.store.assignees.filter(
              (assignee) =>
                assignee.id.toLowerCase().includes(needle) ||
                assignee.display.toLowerCase().includes(needle),
            );
      return matches.slice(0, Math.max(0, limit)).map(clone);
    });
  }

  createFollowup(input: ConfirmedFollowup): Promise<FollowupSummary> {
    return this.run(() => {
      const patient = this.store.patients.find((item) => item.id === input.patient.id);
      if (patient === undefined) {
        throw notFound('Patient was not found.');
      }

      if (input.sourceReference !== undefined) {
        const hasActive = this.store.followups.some(
          (item) =>
            item.sourceReference === input.sourceReference &&
            (item.status === 'not-started' || item.status === 'in-progress'),
        );
        if (hasActive) {
          throw conflict('An active follow-up already exists for this source.');
        }
      }

      const created: FollowupSummary = {
        id: `created-${String(this.nextCreatedId)}`,
        patient: clone(patient),
        title: input.title,
        status: 'not-started',
        priority: input.priority,
      };
      this.nextCreatedId += 1;
      if (input.dueAt !== undefined) {
        created.dueAt = input.dueAt;
      }
      if (input.assignee !== undefined) {
        created.assignee = clone(input.assignee);
      }
      if (input.sourceReference !== undefined) {
        created.sourceReference = input.sourceReference;
      }

      this.store.followups.push(created);
      return clone(created);
    });
  }

  navigate(target: EmrNavigationTarget): Promise<void> {
    return this.run(() => {
      assertValidTarget(target);
      this.navigations.push(clone(target));
    });
  }

  private run<T>(fn: () => T): Promise<T> {
    try {
      return Promise.resolve(fn());
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

function assertValidTarget(target: EmrNavigationTarget): void {
  if (target === null || typeof target !== 'object') {
    throw invalidInput('Navigation target is invalid.');
  }

  switch (target.kind) {
    case 'patient-chart':
      if (typeof target.patientId !== 'string' || target.patientId.trim() === '') {
        throw invalidInput('Navigation target is invalid.');
      }
      return;
    case 'tests-dashboard':
      if (
        target.patientId !== undefined &&
        (typeof target.patientId !== 'string' || target.patientId.trim() === '')
      ) {
        throw invalidInput('Navigation target is invalid.');
      }
      return;
    case 'task-workspace':
      if (typeof target.taskId !== 'string' || target.taskId.trim() === '') {
        throw invalidInput('Navigation target is invalid.');
      }
      return;
    case 'review-queue':
      return;
    default:
      throw invalidInput('Navigation target is invalid.');
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function invalidInput(message: string): AdapterError {
  return new AdapterError('invalid-input', message, false);
}

function notFound(message: string): AdapterError {
  return new AdapterError('not-found', message, false);
}

function conflict(message: string): AdapterError {
  return new AdapterError('conflict', message, false);
}
