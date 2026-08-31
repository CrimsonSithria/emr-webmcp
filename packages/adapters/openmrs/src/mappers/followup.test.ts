import { describe, expect, it } from 'vitest';

import { mapCarePlan } from './followup.js';

describe('mapCarePlan', () => {
  it('maps a CarePlan whose description ends in a marker-shaped invalid source', () => {
    const mapped = mapCarePlan({
      resourceType: 'CarePlan',
      id: 'task-invalid-marker',
      status: 'active',
      title: 'Follow up potassium',
      description:
        'Repeat the BMP in clinic.\n[emr-webmcp:v1 source=Observation/abc def workflow=lablatch]',
      subject: { reference: 'Patient/patient-1', display: 'Ada Lovelace' },
    });

    expect(mapped).toMatchObject({
      id: 'task-invalid-marker',
      title: 'Follow up potassium',
      patient: { id: 'patient-1', display: 'Ada Lovelace' },
    });
    expect(mapped?.sourceReference).toBeUndefined();
  });
});
