import { createOpenmrsAdapter, type OpenmrsFetch } from '@emr-webmcp/openmrs-adapter';
import { openmrsFetch } from '@openmrs/esm-framework';

import { navigateToOpenmrs, toSafeSpaPath } from './navigation';

export const SESSION_PRIVILEGE = 'session';
export const USE_PRIVILEGE = 'emr-webmcp.use';

type OpenmrsFetchInit = {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
};

type OpenmrsFetchLike = (
  path: string,
  init?: OpenmrsFetchInit,
) => Promise<{ status: number; data?: unknown }>;

export function privilegesFromSession(authenticated: boolean): ReadonlySet<string> {
  if (!authenticated) {
    return new Set();
  }
  return new Set([SESSION_PRIVILEGE, USE_PRIVILEGE]);
}

export function wrapOpenmrsFetch(fetchImpl: OpenmrsFetchLike = openmrsFetch): OpenmrsFetch {
  return async (path, init) => {
    try {
      const response = await fetchImpl(path, withJsonContentType(init));
      return { status: response.status, data: response.data };
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      const status = statusOf(error);
      if (status !== undefined) {
        return { status, data: undefined };
      }
      throw error;
    }
  };
}

export function createO3OpenmrsAdapter(options: {
  getActivePatientId: () => string | null;
  fetch?: OpenmrsFetch;
  navigatePath?: (path: string) => void;
  canCreateFollowup?: () => boolean;
}) {
  const fetch = options.fetch ?? wrapOpenmrsFetch();
  return createOpenmrsAdapter({
    fetch,
    getActivePatientId: options.getActivePatientId,
    canCreateFollowup: options.canCreateFollowup ?? (() => true),
    navigate: (target) => {
      const path = toSafeSpaPath(target);
      if (options.navigatePath !== undefined) {
        options.navigatePath(path);
        return;
      }
      navigateToOpenmrs(path);
    },
  });
}

/**
 * openmrsFetch JSON-serialises plain-object bodies but leaves Content-Type to the
 * browser, which defaults to text/plain — the REST module then rejects the POST.
 */
export function withJsonContentType(init: OpenmrsFetchInit | undefined): OpenmrsFetchInit | undefined {
  if (init === undefined || init.body === undefined) {
    return init;
  }
  return { ...init, headers: { ...init.headers, 'Content-Type': 'application/json' } };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
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
