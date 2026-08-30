import { AdapterError, type EmrNavigationTarget } from '@emr-webmcp/core';
import { navigate } from '@openmrs/esm-framework';

const UNSAFE = /:\/\/|\/\/|[?#]|\.\./;

export function toSafeSpaPath(target: EmrNavigationTarget): string {
  if (target === null || typeof target !== 'object') {
    throw invalidNavigation();
  }

  switch (target.kind) {
    case 'review-queue':
      return assertSafePath('/emr-webmcp');
    case 'patient-chart':
      return assertSafePath(`/patient/${encodeSegment(target.patientId)}/chart`);
    case 'tests-dashboard':
      if (target.patientId === undefined) {
        return assertSafePath('/home');
      }
      return assertSafePath(`/patient/${encodeSegment(target.patientId)}/chart/Results`);
    case 'task-workspace':
      return assertSafePath(`/task/${encodeSegment(target.taskId)}`);
    default:
      throw invalidNavigation();
  }
}

export function navigateToOpenmrs(path: string, go: (to: string) => void = defaultGo): void {
  assertSafePath(path);
  go(`\${openmrsSpaBase}${path}`);
}

function defaultGo(to: string): void {
  navigate({ to });
}

function encodeSegment(value: string | undefined): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalidNavigation();
  }
  assertSafeToken(value);
  return encodeURIComponent(value);
}

function assertSafeToken(value: string): void {
  if (UNSAFE.test(value)) {
    throw invalidNavigation();
  }
}

function assertSafePath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//') || UNSAFE.test(path)) {
    throw invalidNavigation();
  }
  return path;
}

function invalidNavigation(): AdapterError {
  return new AdapterError('invalid-input', 'Navigation target is invalid.', false);
}
