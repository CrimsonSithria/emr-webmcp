import type { EmrCapability } from '@emr-webmcp/core';
import type { OpenmrsFetch } from '@emr-webmcp/openmrs-adapter';

export const PHASE1_CAPABILITIES: readonly EmrCapability[] = [
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

const TASKS_PATH = '/ws/rest/v1/tasks/careplan';
const TASK_CAPABILITIES: readonly EmrCapability[] = ['list-followups', 'create-followup'];

export type CapabilityProbe = () => Promise<ReadonlySet<EmrCapability>>;

export function createDefaultCapabilityProbe(options: {
  fetch: OpenmrsFetch;
  isAuthenticated: () => boolean;
}): CapabilityProbe {
  return async () => {
    if (!options.isAuthenticated()) {
      return new Set();
    }

    const capabilities = new Set<EmrCapability>(PHASE1_CAPABILITIES);
    if (await tasksMissing(options.fetch)) {
      for (const capability of TASK_CAPABILITIES) {
        capabilities.delete(capability);
      }
    }
    return capabilities;
  };
}

async function tasksMissing(fetch: OpenmrsFetch): Promise<boolean> {
  try {
    const response = await fetch(TASKS_PATH);
    return response.status === 404;
  } catch (error) {
    return statusOf(error) === 404;
  }
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  if ('response' in error) {
    const response = (error as { response?: { status?: unknown } }).response;
    if (response !== undefined && typeof response.status === 'number') {
      return response.status;
    }
  }
  if ('status' in error && typeof (error as { status?: unknown }).status === 'number') {
    return (error as { status: number }).status;
  }
  return undefined;
}
