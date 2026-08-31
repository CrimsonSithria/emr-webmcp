import {
  AdapterError,
  type ChartBrief,
  type EmrAdapter,
  type FollowupQuery,
  type FollowupSummary,
  type PatientRef,
  type ResultQuery,
  type ResultSummary,
} from '@emr-webmcp/core';

export type FocusedReviewInput = {
  patientId?: string;
};

export type FocusedReviewResult = {
  patient: PatientRef;
  brief: ChartBrief;
  abnormalResults: ResultSummary[];
  openFollowups: FollowupSummary[];
};

export async function focusedReview(
  adapter: EmrAdapter,
  input: FocusedReviewInput = {},
): Promise<FocusedReviewResult> {
  const patientId = await resolveFocusedPatientId(adapter, input.patientId);
  const resultsQuery: ResultQuery = { limit: 100, patientId };
  const followupsQuery: FollowupQuery = { limit: 100, patientId };
  const [brief, abnormalResults, followups] = await Promise.all([
    adapter.getChartBrief(patientId),
    adapter.listAbnormalResults(resultsQuery),
    adapter.listFollowups(followupsQuery),
  ]);

  if (brief.patient.id !== patientId) {
    throw new AdapterError('invalid-input', 'Patient mismatch.', false);
  }

  return {
    patient: brief.patient,
    brief,
    abnormalResults: abnormalResults.filter((item) => item.patient.id === patientId),
    openFollowups: followups.filter(
      (item) =>
        item.patient.id === patientId &&
        (item.status === 'not-started' || item.status === 'in-progress'),
    ),
  };
}

async function resolveFocusedPatientId(
  adapter: EmrAdapter,
  requestedPatientId: string | undefined,
): Promise<string> {
  const active = await adapter.getActivePatient();
  if (requestedPatientId !== undefined) {
    if (active !== null && active.id !== requestedPatientId) {
      throw new AdapterError('invalid-input', 'Patient mismatch.', false);
    }
    return requestedPatientId;
  }
  if (active === null) {
    throw new AdapterError('not-found', 'No active patient.', false);
  }
  return active.id;
}
