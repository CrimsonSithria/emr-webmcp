import { AdapterError, type EmrNavigationTarget } from '@emr-webmcp/core';
import { navigate } from '@openmrs/esm-framework';
import { describe, expect, it, vi } from 'vitest';

import { navigateToOpenmrs, toSafeSpaPath } from './navigation';

describe('toSafeSpaPath', () => {
  it('maps known patient chart, Tests, Tasks, and review routes', () => {
    expect(toSafeSpaPath({ kind: 'review-queue' })).toBe('/emr-webmcp');
    expect(toSafeSpaPath({ kind: 'patient-chart', patientId: 'patient-ada' })).toBe(
      '/patient/patient-ada/chart',
    );
    expect(toSafeSpaPath({ kind: 'tests-dashboard', patientId: 'patient-ada' })).toBe(
      '/patient/patient-ada/chart/Results',
    );
    expect(toSafeSpaPath({ kind: 'tests-dashboard' })).toBe('/home');
    expect(toSafeSpaPath({ kind: 'task-workspace', taskId: 'task-1' })).toBe('/task/task-1');
  });

  it('encodes only path parameters and never accepts a full URL', () => {
    expect(toSafeSpaPath({ kind: 'patient-chart', patientId: 'ada lovelace' })).toBe(
      '/patient/ada%20lovelace/chart',
    );
    expect(toSafeSpaPath({ kind: 'task-workspace', taskId: 'task/1' })).toBe('/task/task%2F1');
  });

  it('rejects unknown kinds and empty ids', () => {
    expect(() => toSafeSpaPath({ kind: 'unknown-place' } as unknown as EmrNavigationTarget)).toThrow(AdapterError);
    expect(() => toSafeSpaPath({ kind: 'patient-chart', patientId: '' })).toThrow(AdapterError);
    expect(() => toSafeSpaPath({ kind: 'task-workspace', taskId: '   ' })).toThrow(AdapterError);
    expect(() => toSafeSpaPath({ kind: 'tests-dashboard', patientId: '' })).toThrow(AdapterError);
  });

  it('rejects targets whose parameters would produce ://, //, ?, #, or ..', () => {
    const rejected: EmrNavigationTarget[] = [
      { kind: 'patient-chart', patientId: 'https://evil.example/x' },
      { kind: 'patient-chart', patientId: 'foo?x=1' },
      { kind: 'patient-chart', patientId: 'foo#hash' },
      { kind: 'patient-chart', patientId: '..' },
      { kind: 'patient-chart', patientId: '../admin' },
      { kind: 'task-workspace', taskId: '//evil.example' },
    ];

    for (const target of rejected) {
      expect(() => toSafeSpaPath(target)).toThrow(AdapterError);
      try {
        toSafeSpaPath(target);
      } catch (error) {
        expect(error).toMatchObject({ code: 'invalid-input' });
      }
    }
  });
});

describe('navigateToOpenmrs', () => {
  it('hands a spa-relative path to O3 navigate and refuses unsafe paths', () => {
    navigateToOpenmrs('/emr-webmcp');
    expect(navigate).toHaveBeenCalledWith({ to: '${openmrsSpaBase}/emr-webmcp' });

    expect(() => navigateToOpenmrs('https://evil.example')).toThrow(AdapterError);
    expect(() => navigateToOpenmrs('/patient/foo?leak=1')).toThrow(AdapterError);
    expect(() => navigateToOpenmrs('/patient/foo#hash')).toThrow(AdapterError);
    expect(() => navigateToOpenmrs('//evil.example')).toThrow(AdapterError);
    expect(() => navigateToOpenmrs('/patient/../admin')).toThrow(AdapterError);
    expect(vi.mocked(navigate).mock.calls).toHaveLength(1);
  });
});
