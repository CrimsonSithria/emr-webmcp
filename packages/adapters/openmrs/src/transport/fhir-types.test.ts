import { describe, expect, it } from 'vitest';

import { readNextLink, toRequestPath } from './fhir-types.js';

describe('toRequestPath', () => {
  it('strips the OpenMRS webapp prefix from relative and absolute next links', () => {
    expect(toRequestPath('/openmrs/ws/rest/v1/patient?q=John&startIndex=5')).toBe(
      '/ws/rest/v1/patient?q=John&startIndex=5',
    );
    expect(
      toRequestPath('https://emr.example/openmrs/ws/rest/v1/patient?q=John&startIndex=5'),
    ).toBe('/ws/rest/v1/patient?q=John&startIndex=5');
    expect(toRequestPath('/ws/rest/v1/patient?q=John')).toBe('/ws/rest/v1/patient?q=John');
    expect(toRequestPath('/openmrs')).toBe('/');
  });
});

describe('readNextLink', () => {
  it('reads REST uri links and FHIR url links', () => {
    expect(
      readNextLink({
        links: [{ rel: 'next', uri: '/openmrs/ws/rest/v1/patient?startIndex=5' }],
      }),
    ).toBe('/ws/rest/v1/patient?startIndex=5');
    expect(
      readNextLink({
        link: [{ relation: 'next', url: 'https://emr.example/openmrs/ws/fhir2/R4/Observation?_getpagesoffset=2' }],
      }),
    ).toBe('/ws/fhir2/R4/Observation?_getpagesoffset=2');
  });
});
