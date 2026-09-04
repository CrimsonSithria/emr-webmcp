import { describe, expect, it, vi } from 'vitest';

import { withJsonContentType, wrapOpenmrsFetch } from './adapter-factory';

describe('wrapOpenmrsFetch', () => {
  it('declares a JSON body so the REST module does not see text/plain', async () => {
    const fetchImpl = vi.fn(async () => ({ status: 201, data: { id: 'careplan-1' } }));
    const fetch = wrapOpenmrsFetch(fetchImpl);

    const body = { resourceType: 'CarePlan', status: 'active' };
    const response = await fetch('/ws/rest/v1/tasks/careplan', { method: 'POST', body });

    expect(response).toEqual({ status: 201, data: { id: 'careplan-1' } });
    expect(fetchImpl).toHaveBeenCalledWith('/ws/rest/v1/tasks/careplan', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it('leaves body-less requests untouched', async () => {
    const fetchImpl = vi.fn(async () => ({ status: 200, data: [] }));
    const fetch = wrapOpenmrsFetch(fetchImpl);
    const signal = new AbortController().signal;

    await fetch('/ws/rest/v1/patient?q=Ada', { signal });
    await fetch('/ws/rest/v1/session');

    expect(fetchImpl).toHaveBeenNthCalledWith(1, '/ws/rest/v1/patient?q=Ada', { signal });
    expect(fetchImpl).toHaveBeenNthCalledWith(2, '/ws/rest/v1/session', undefined);
  });

  it('maps thrown HTTP errors to a status and rethrows aborts', async () => {
    const fetch = wrapOpenmrsFetch(
      vi.fn(async () => {
        throw { response: { status: 404 } };
      }),
    );
    await expect(fetch('/ws/rest/v1/tasks/careplan?subject=x')).resolves.toEqual({
      status: 404,
      data: undefined,
    });

    const abort = new Error('aborted');
    abort.name = 'AbortError';
    const aborting = wrapOpenmrsFetch(
      vi.fn(async () => {
        throw abort;
      }),
    );
    await expect(aborting('/ws/rest/v1/patient')).rejects.toBe(abort);
  });
});

describe('withJsonContentType', () => {
  it('preserves caller headers while forcing the JSON content type', () => {
    expect(
      withJsonContentType({
        method: 'POST',
        body: '{}',
        headers: { Accept: 'application/fhir+json', 'Content-Type': 'text/plain' },
      }),
    ).toEqual({
      method: 'POST',
      body: '{}',
      headers: { Accept: 'application/fhir+json', 'Content-Type': 'application/json' },
    });
    expect(withJsonContentType(undefined)).toBeUndefined();
  });
});
