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

import { mapAppointment } from './mappers/appointment.js';
import { mapCarePlan, mapProvider, mapRole, toCarePlan } from './mappers/followup.js';
import { mapCodeableItem, mapPatient } from './mappers/patient.js';
import { mapObservation } from './mappers/result.js';
import { codeableDisplay } from './transport/fhir-types.js';
import { OpenmrsClient, type OpenmrsFetch } from './transport/openmrs-client.js';

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

const SEARCH_LIMIT = 20;
const ABNORMAL_LIMIT = 100;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export type { OpenmrsFetch };

export type OpenmrsNavigate = (target: EmrNavigationTarget) => Promise<void> | void;

export type OpenmrsAdapterOptions = {
  fetch: OpenmrsFetch;
  now?: () => Date;
  navigate?: OpenmrsNavigate;
  getActivePatientId?: () => string | null;
  signal?: AbortSignal;
};

export function createOpenmrsAdapter(options: OpenmrsAdapterOptions): EmrAdapter {
  return new OpenmrsAdapter(options);
}

class OpenmrsAdapter implements EmrAdapter {
  readonly id = 'openmrs';
  private readonly client: OpenmrsClient;
  private readonly now: () => Date;
  private readonly navigateImpl?: OpenmrsNavigate;
  private readonly getActivePatientId?: () => string | null;
  private readonly signal?: AbortSignal;

  constructor(options: OpenmrsAdapterOptions) {
    this.client = new OpenmrsClient(options.fetch);
    this.now = options.now ?? (() => new Date());
    if (options.navigate !== undefined) {
      this.navigateImpl = options.navigate;
    }
    if (options.getActivePatientId !== undefined) {
      this.getActivePatientId = options.getActivePatientId;
    }
    if (options.signal !== undefined) {
      this.signal = options.signal;
    }
  }

  getCapabilities(): Promise<ReadonlySet<EmrCapability>> {
    return Promise.resolve(new Set(ALL_CAPABILITIES));
  }

  async getActivePatient(): Promise<PatientRef | null> {
    const id = this.getActivePatientId?.();
    if (id === undefined || id === null || id.trim() === '') {
      return null;
    }
    try {
      return await this.requirePatient(id);
    } catch (error) {
      if (error instanceof AdapterError && error.code === 'not-found') {
        return null;
      }
      throw error;
    }
  }

  async searchPatients(query: string, limit: number): Promise<PatientRef[]> {
    const needle = query.trim();
    if (needle === '') {
      throw invalidInput('Search query must be non-empty.');
    }
    if (limit < 1) {
      throw invalidInput('Search limit must be at least 1.');
    }

    const raw = await this.client.searchPatients(needle, Math.min(limit, SEARCH_LIMIT), this.signal);
    return present(raw.map(mapPatient)).slice(0, Math.min(limit, SEARCH_LIMIT));
  }

  async listAppointments(input: AppointmentQuery): Promise<AppointmentSummary[]> {
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

    const raw = await this.client.listAppointments(start, end, this.signal);
    return present(raw.map(mapAppointment)).filter((appointment) => {
      const at = Date.parse(appointment.start);
      return Number.isFinite(at) && at >= startMs && at <= endMs;
    });
  }

  async getChartBrief(patientId: string): Promise<ChartBrief> {
    const patient = await this.requirePatient(patientId);
    const [conditions, allergies, medications, labs, vitals, tasks] = await Promise.all([
      this.client.searchConditions(patientId, this.signal),
      this.client.searchAllergies(patientId, this.signal),
      this.client.searchMedications(patientId, this.signal),
      this.client.searchObservations(this.observationQuery('laboratory', patientId)),
      this.client.searchObservations(this.observationQuery('vital-signs', patientId)),
      this.client.listCarePlans(patientId, this.signal),
    ]);

    return {
      patient,
      conditions: present(
        conditions.map((item) => mapCodeableItem(item.id, codeableDisplay(item.code))),
      ),
      allergies: present(
        allergies.map((item) => mapCodeableItem(item.id, codeableDisplay(item.code))),
      ),
      medications: present(
        medications.map((item) =>
          mapCodeableItem(
            item.id,
            codeableDisplay(item.medicationCodeableConcept) ?? item.medicationReference?.display,
          ),
        ),
      ),
      recentVitals: present(vitals.map(mapObservation)),
      recentResults: present(labs.map(mapObservation)),
      openTasks: present(tasks.map(mapCarePlan)).filter(
        (item) => item.status === 'not-started' || item.status === 'in-progress',
      ),
    };
  }

  async listAbnormalResults(input: ResultQuery): Promise<ResultSummary[]> {
    const cap = Math.max(0, Math.min(input.limit, ABNORMAL_LIMIT));
    const patientIds = await this.resolvePatientIds(input.patientId);
    const matches: ResultSummary[] = [];
    for (const patientId of patientIds) {
      if (matches.length >= cap) {
        break;
      }
      const raw = await this.client.searchObservations(this.observationQuery('laboratory', patientId));
      matches.push(
        ...present(raw.map(mapObservation)).filter(
          (item) => item.interpretation !== 'normal' && item.interpretation !== 'unknown',
        ),
      );
    }
    return matches.slice(0, cap);
  }

  async getResult(resultId: string): Promise<ResultSummary> {
    try {
      const mapped = mapObservation(await this.client.getObservation(resultId, this.signal));
      if (mapped === undefined) {
        throw notFound('Result was not found.');
      }
      return mapped;
    } catch (error) {
      throw remapNotFound(error, 'Result was not found.');
    }
  }

  async listFollowups(input: FollowupQuery): Promise<FollowupSummary[]> {
    const cap = Math.max(0, input.limit);
    const patientIds = await this.resolvePatientIds(input.patientId);
    const nowMs = this.now().getTime();
    const matches: FollowupSummary[] = [];
    for (const patientId of patientIds) {
      if (matches.length >= cap) {
        break;
      }
      const raw = await this.client.listCarePlans(patientId, this.signal);
      matches.push(
        ...present(raw.map(mapCarePlan)).filter((item) => {
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
        }),
      );
    }
    return matches.slice(0, cap);
  }

  async listAssignees(query: string, limit: number): Promise<AssigneeSummary[]> {
    const [providers, roles] = await Promise.all([
      this.client.searchProviders(query.trim(), Math.max(0, limit), this.signal),
      this.client.searchRoles(query.trim(), Math.max(0, limit), this.signal),
    ]);
    return [...present(providers.map(mapProvider)), ...present(roles.map(mapRole))].slice(
      0,
      Math.max(0, limit),
    );
  }

  async createFollowup(input: ConfirmedFollowup): Promise<FollowupSummary> {
    await this.requirePatient(input.patient.id);

    if (input.sourceReference !== undefined) {
      const existing = await this.listFollowups({
        limit: 1000,
        patientId: input.patient.id,
      });
      const hasActive = existing.some(
        (item) =>
          item.sourceReference === input.sourceReference &&
          (item.status === 'not-started' || item.status === 'in-progress'),
      );
      if (hasActive) {
        throw new AdapterError(
          'conflict',
          'An active follow-up already exists for this source.',
          false,
        );
      }
    }

    const created = mapCarePlan(await this.client.createCarePlan(toCarePlan(input), this.signal));
    if (created === undefined) {
      throw new AdapterError('upstream', 'Upstream request failed', true);
    }
    return created;
  }

  async navigate(target: EmrNavigationTarget): Promise<void> {
    assertValidTarget(target);
    if (this.navigateImpl !== undefined) {
      await this.navigateImpl(target);
    }
  }

  private observationQuery(
    category: string,
    patientId: string,
  ): { category: string; patientId: string; signal?: AbortSignal } {
    const query: { category: string; patientId: string; signal?: AbortSignal } = {
      category,
      patientId,
    };
    if (this.signal !== undefined) {
      query.signal = this.signal;
    }
    return query;
  }

  private async resolvePatientIds(patientId?: string): Promise<string[]> {
    if (patientId !== undefined) {
      return [patientId];
    }
    const raw = await this.client.listPatients(SEARCH_LIMIT, this.signal);
    return present(raw.map(mapPatient))
      .map((patient) => patient.id)
      .slice(0, SEARCH_LIMIT);
  }

  private async requirePatient(patientId: string): Promise<PatientRef> {
    try {
      const mapped = mapPatient(await this.client.getPatient(patientId, this.signal));
      if (mapped === undefined) {
        throw notFound('Patient was not found.');
      }
      return mapped;
    } catch (error) {
      throw remapNotFound(error, 'Patient was not found.');
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

function present<T>(values: Array<T | undefined>): T[] {
  return values.filter((value): value is T => value !== undefined);
}

function invalidInput(message: string): AdapterError {
  return new AdapterError('invalid-input', message, false);
}

function notFound(message: string): AdapterError {
  return new AdapterError('not-found', message, false);
}

function remapNotFound(error: unknown, message: string): AdapterError {
  if (error instanceof AdapterError && error.code === 'not-found') {
    return notFound(message);
  }
  if (error instanceof AdapterError) {
    return error;
  }
  throw error;
}
