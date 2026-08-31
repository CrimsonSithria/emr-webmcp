import type {
  AssigneeSummary,
  AppointmentSummary,
  FollowupSummary,
  PatientRef,
  ResultSummary,
} from '@emr-webmcp/core';

export const FIXTURE_NOW_ISO = '2026-08-31T12:00:00.000Z';

export type ChartExtras = {
  conditions: Array<{ id: string; display: string }>;
  allergies: Array<{ id: string; display: string }>;
  medications: Array<{ id: string; display: string }>;
};

export type FixtureStore = {
  patients: PatientRef[];
  appointments: AppointmentSummary[];
  results: ResultSummary[];
  vitalIds: string[];
  followups: FollowupSummary[];
  assignees: AssigneeSummary[];
  charts: Record<string, ChartExtras>;
  activePatientId: string | null;
};

function emptyChart(): ChartExtras {
  return { conditions: [], allergies: [], medications: [] };
}

export function createFixtureStore(): FixtureStore {
  const ada: PatientRef = { id: 'patient-01', display: 'Ada Lovelace' };
  const alan: PatientRef = { id: 'patient-02', display: 'Alan Turing' };
  const grace: PatientRef = { id: 'patient-03', display: 'Grace Hopper' };
  const katherine: PatientRef = { id: 'patient-04', display: 'Katherine Johnson' };
  const dorothy: PatientRef = { id: 'patient-05', display: 'Dorothy Vaughan' };
  const mary: PatientRef = { id: 'patient-06', display: 'Mary Jackson' };
  const claude: PatientRef = { id: 'patient-07', display: 'Claude Shannon' };
  const john: PatientRef = { id: 'patient-08', display: 'John von Neumann' };
  const barbara: PatientRef = { id: 'patient-09', display: 'Barbara Liskov' };
  const frances: PatientRef = { id: 'patient-10', display: 'Frances Allen' };
  const donald: PatientRef = { id: 'patient-11', display: 'Donald Knuth' };
  const edsger: PatientRef = { id: 'patient-12', display: 'Edsger Dijkstra' };

  const drChen: AssigneeSummary = {
    id: 'person-dr-chen',
    display: 'Dr. Chen',
    type: 'person',
  };
  const clinicNurse: AssigneeSummary = {
    id: 'role-clinic-nurse',
    display: 'Clinic nurse',
    type: 'role',
  };
  const nurseRivera: AssigneeSummary = {
    id: 'person-nurse-rivera',
    display: 'Nurse Rivera',
    type: 'person',
  };
  const labReviewer: AssigneeSummary = {
    id: 'role-lab-reviewer',
    display: 'Lab reviewer',
    type: 'role',
  };

  const potassium: ResultSummary = {
    id: 'obs-01',
    patient: ada,
    name: 'Potassium',
    value: '5.8',
    unit: 'mmol/L',
    observedAt: '2026-08-30T08:00:00.000Z',
    interpretation: 'high',
    referenceRange: '3.5-5.1',
    sourceReference: 'Observation/obs-01',
  };
  const sodium: ResultSummary = {
    id: 'obs-02',
    patient: alan,
    name: 'Sodium',
    value: '128',
    unit: 'mmol/L',
    observedAt: '2026-08-29T11:00:00.000Z',
    interpretation: 'low',
    referenceRange: '135-145',
    sourceReference: 'Observation/obs-02',
  };
  const glucose: ResultSummary = {
    id: 'obs-03',
    patient: grace,
    name: 'Glucose',
    value: '24.0',
    unit: 'mmol/L',
    observedAt: '2026-08-28T16:30:00.000Z',
    interpretation: 'critical-high',
    referenceRange: '3.9-6.1',
    sourceReference: 'Observation/obs-03',
  };
  const hemoglobin: ResultSummary = {
    id: 'obs-04',
    patient: katherine,
    name: 'Hemoglobin',
    value: '6.2',
    unit: 'g/dL',
    observedAt: '2026-08-27T09:15:00.000Z',
    interpretation: 'critical-low',
    referenceRange: '12.0-15.5',
    sourceReference: 'Observation/obs-04',
  };
  const heartRate: ResultSummary = {
    id: 'obs-05',
    patient: ada,
    name: 'Heart rate',
    value: '72',
    unit: '/min',
    observedAt: '2026-08-31T08:00:00.000Z',
    interpretation: 'normal',
    referenceRange: '60-100',
    sourceReference: 'Observation/obs-05',
  };
  const platelets: ResultSummary = {
    id: 'obs-06',
    patient: dorothy,
    name: 'Platelets',
    observedAt: '2026-08-26T13:00:00.000Z',
    interpretation: 'unknown',
    sourceReference: 'Observation/obs-06',
  };
  const wbc: ResultSummary = {
    id: 'obs-07',
    patient: mary,
    name: 'White blood cells',
    value: '6.0',
    unit: '10^9/L',
    observedAt: '2026-08-25T10:00:00.000Z',
    interpretation: 'normal',
    referenceRange: '4.0-11.0',
    sourceReference: 'Observation/obs-07',
  };
  const creatinine: ResultSummary = {
    id: 'obs-08',
    patient: claude,
    name: 'Creatinine',
    value: '180',
    unit: 'umol/L',
    observedAt: '2026-08-24T15:45:00.000Z',
    interpretation: 'high',
    referenceRange: '45-90',
    sourceReference: 'Observation/obs-08',
  };

  return {
    patients: [
      ada,
      alan,
      grace,
      katherine,
      dorothy,
      mary,
      claude,
      john,
      barbara,
      frances,
      donald,
      edsger,
    ],
    assignees: [drChen, clinicNurse, nurseRivera, labReviewer],
    vitalIds: [heartRate.id],
    activePatientId: ada.id,
    results: [potassium, sodium, glucose, hemoglobin, heartRate, platelets, wbc, creatinine],
    appointments: [
      {
        id: 'appt-01',
        patient: ada,
        start: '2026-09-01T09:00:00.000Z',
        status: 'scheduled',
        service: 'Diabetes clinic',
      },
      {
        id: 'appt-02',
        patient: alan,
        start: '2026-09-01T10:00:00.000Z',
        status: 'checked-in',
      },
      {
        id: 'appt-03',
        patient: grace,
        start: '2026-09-03T14:00:00.000Z',
        status: 'completed',
      },
      {
        id: 'appt-04',
        patient: katherine,
        start: '2026-09-07T11:00:00.000Z',
        status: 'scheduled',
      },
      {
        id: 'appt-05',
        patient: dorothy,
        start: '2026-08-01T09:00:00.000Z',
        status: 'cancelled',
      },
      {
        id: 'appt-06',
        patient: mary,
        start: '2026-09-15T09:00:00.000Z',
        status: 'scheduled',
      },
      {
        id: 'appt-07',
        patient: john,
        start: '2026-09-02T08:30:00.000Z',
        status: 'unknown',
      },
    ],
    followups: [
      {
        id: 'task-01',
        patient: ada,
        title: 'Follow up potassium',
        status: 'not-started',
        priority: 'high',
        dueAt: '2026-08-30T09:00:00.000Z',
        assignee: drChen,
        sourceReference: 'Observation/obs-01',
      },
      {
        id: 'task-02',
        patient: ada,
        title: 'Review clinic prep',
        status: 'not-started',
        priority: 'medium',
        dueAt: '2026-09-02T09:00:00.000Z',
        assignee: clinicNurse,
      },
      {
        id: 'task-03',
        patient: alan,
        title: 'Follow up sodium',
        status: 'in-progress',
        priority: 'high',
        dueAt: '2026-09-01T09:00:00.000Z',
        assignee: drChen,
        sourceReference: 'Observation/obs-02',
      },
      {
        id: 'task-04',
        patient: grace,
        title: 'Active duplicate source',
        status: 'in-progress',
        priority: 'medium',
        sourceReference: 'Observation/obs-active-dup',
      },
      {
        id: 'task-05',
        patient: katherine,
        title: 'Completed source',
        status: 'completed',
        priority: 'low',
        dueAt: '2026-08-20T09:00:00.000Z',
        sourceReference: 'Observation/obs-completed-ok',
      },
      {
        id: 'task-06',
        patient: dorothy,
        title: 'Cancelled source',
        status: 'cancelled',
        priority: 'low',
        sourceReference: 'Observation/obs-cancelled-ok',
      },
      {
        id: 'task-07',
        patient: mary,
        title: 'Overdue paperwork',
        status: 'not-started',
        priority: 'low',
        dueAt: '2026-08-15T09:00:00.000Z',
      },
      {
        id: 'task-08',
        patient: claude,
        title: 'Unknown status task',
        status: 'unknown',
        priority: 'medium',
      },
    ],
    charts: {
      'patient-01': {
        conditions: [{ id: 'cond-01', display: 'Type 2 diabetes' }],
        allergies: [{ id: 'alg-01', display: 'Penicillin' }],
        medications: [{ id: 'med-01', display: 'Metformin' }],
      },
      'patient-02': emptyChart(),
      'patient-03': emptyChart(),
      'patient-04': emptyChart(),
      'patient-05': emptyChart(),
      'patient-06': emptyChart(),
      'patient-07': emptyChart(),
      'patient-08': emptyChart(),
      'patient-09': emptyChart(),
      'patient-10': emptyChart(),
      'patient-11': emptyChart(),
      'patient-12': emptyChart(),
    },
  };
}
