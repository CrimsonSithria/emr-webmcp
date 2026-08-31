import { AdapterError, type EmrNavigationTarget } from '@emr-webmcp/core';
import { createFixtureAdapter } from '@emr-webmcp/contract-fixture';
import { describe, expect, it } from 'vitest';

import { CONTRACT_NOW, describeAdapterContract } from './adapter-contract.js';

describeAdapterContract((options) => createFixtureAdapter(options));

describe('fixture adapter seed', () => {
  it('exposes twelve deterministic patients', async () => {
    const adapter = createFixtureAdapter({ now: () => CONTRACT_NOW });
    const patients = await adapter.searchPatients('patient-', 20);

    expect(patients).toHaveLength(12);
  });

  it('records accepted navigation targets and ignores rejected ones', async () => {
    const adapter = createFixtureAdapter({ now: () => CONTRACT_NOW });
    const review: EmrNavigationTarget = { kind: 'review-queue' };
    const chart: EmrNavigationTarget = { kind: 'patient-chart', patientId: 'patient-01' };

    await adapter.navigate(review);
    await expect(adapter.navigate({ kind: 'patient-chart', patientId: '' })).rejects.toBeInstanceOf(
      AdapterError,
    );
    await adapter.navigate(chart);

    expect(adapter.recordedNavigations).toEqual([review, chart]);
  });
});
