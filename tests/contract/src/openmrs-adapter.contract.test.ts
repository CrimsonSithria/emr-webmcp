import { createOpenmrsAdapter, type OpenmrsAdapterOptions } from '@emr-webmcp/openmrs-adapter';
import { createOpenmrsMswFetch, createOpenmrsMswStore } from '@emr-webmcp/openmrs-adapter/testing';

import { describeAdapterContract } from './adapter-contract.js';

describeAdapterContract((options) => {
  const store = createOpenmrsMswStore();
  const adapterOptions: OpenmrsAdapterOptions = {
    fetch: createOpenmrsMswFetch(store),
    navigate: () => undefined,
    getActivePatientId: () => store.activePatientId,
  };
  if (options?.now !== undefined) {
    adapterOptions.now = options.now;
  }
  return createOpenmrsAdapter(adapterOptions);
});
