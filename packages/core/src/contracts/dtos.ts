export type PatientRef = {
  id: string;
  display: string;
};

export type AppointmentSummary = {
  id: string;
  patient: PatientRef;
  start: string;
  status: 'scheduled' | 'checked-in' | 'completed' | 'cancelled' | 'unknown';
  service?: string;
};

export type ResultSummary = {
  id: string;
  patient: PatientRef;
  name: string;
  value?: string;
  unit?: string;
  observedAt: string;
  interpretation: 'critical-low' | 'low' | 'normal' | 'high' | 'critical-high' | 'unknown';
  referenceRange?: string;
  sourceReference: string;
};

export type FollowupSummary = {
  id: string;
  patient: PatientRef;
  title: string;
  status: 'not-started' | 'in-progress' | 'completed' | 'cancelled' | 'unknown';
  priority: 'low' | 'medium' | 'high';
  dueAt?: string;
  assignee?: { id: string; display: string; type: 'person' | 'role' };
  sourceReference?: string;
};

export type FollowupDraft = {
  draftId: string;
  patient: PatientRef;
  title: string;
  rationale: string;
  priority: 'low' | 'medium' | 'high';
  dueAt?: string;
  assignee?: { id: string; display: string; type: 'person' | 'role' };
  sourceReference?: string;
};

export type AssigneeSummary = {
  id: string;
  display: string;
  type: 'person' | 'role';
};

export type ChartBrief = {
  patient: PatientRef;
  conditions: ReadonlyArray<{ id: string; display: string }>;
  allergies: ReadonlyArray<{ id: string; display: string }>;
  medications: ReadonlyArray<{ id: string; display: string }>;
  recentVitals: ReadonlyArray<ResultSummary>;
  recentResults: ReadonlyArray<ResultSummary>;
  openTasks: ReadonlyArray<FollowupSummary>;
};

export type ConfirmedFollowup = {
  patient: PatientRef;
  title: string;
  rationale: string;
  priority: 'low' | 'medium' | 'high';
  dueAt?: string;
  assignee?: AssigneeSummary;
  sourceReference?: string;
};
