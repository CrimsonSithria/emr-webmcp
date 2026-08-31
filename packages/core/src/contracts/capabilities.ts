export type EmrNavigationTarget =
  | { kind: 'patient-chart'; patientId: string }
  | { kind: 'tests-dashboard'; patientId?: string }
  | { kind: 'task-workspace'; taskId: string }
  | { kind: 'review-queue' };

export type EmrCapability =
  | 'search-patients'
  | 'list-appointments'
  | 'get-chart-brief'
  | 'list-abnormal-results'
  | 'get-result'
  | 'list-followups'
  | 'list-assignees'
  | 'create-followup'
  | 'navigate-patient-chart'
  | 'navigate-tests'
  | 'navigate-tasks'
  | 'navigate-review-queue';
