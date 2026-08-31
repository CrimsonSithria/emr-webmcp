import type {
  EmrAdapter,
  FollowupQuery,
  FollowupSummary,
  ResultQuery,
  ResultSummary,
} from '@emr-webmcp/core';

export const UNLATCHED_LIMIT = 100;
export const FOLLOWUP_JOIN_LIMIT = 1000;

const ACTIVE_LATCH_STATUSES: ReadonlySet<FollowupSummary['status']> = new Set([
  'not-started',
  'in-progress',
]);

export type FindUnlatchedInput = {
  patientId?: string;
  limit?: number;
};

export type FindUnlatchedResult = {
  items: ResultSummary[];
  truncated: boolean;
};

export async function findUnlatched(
  adapter: EmrAdapter,
  input: FindUnlatchedInput = {},
): Promise<FindUnlatchedResult> {
  const limit = resolveLimit(input.limit);
  const resultsQuery: ResultQuery = { limit: UNLATCHED_LIMIT };
  const followupsQuery: FollowupQuery = { limit: FOLLOWUP_JOIN_LIMIT };
  if (input.patientId !== undefined) {
    resultsQuery.patientId = input.patientId;
    followupsQuery.patientId = input.patientId;
  }

  const [results, followups] = await Promise.all([
    adapter.listAbnormalResults(resultsQuery),
    adapter.listFollowups(followupsQuery),
  ]);

  const latchedKeys = new Set(
    followups
      .filter(
        (item) =>
          ACTIVE_LATCH_STATUSES.has(item.status) &&
          item.sourceReference !== undefined &&
          item.sourceReference !== '',
      )
      .map((item) => latchKey(item.patient.id, item.sourceReference ?? '')),
  );

  const unlatched = results.filter(
    (item) => !latchedKeys.has(latchKey(item.patient.id, item.sourceReference)),
  );
  const items = unlatched.slice(0, limit);
  const resultsTruncated = results.length >= UNLATCHED_LIMIT;
  const followupsTruncated = followups.length >= FOLLOWUP_JOIN_LIMIT;

  return {
    items,
    truncated: resultsTruncated || followupsTruncated || unlatched.length > items.length,
  };
}

function resolveLimit(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested) || requested < 1) {
    return UNLATCHED_LIMIT;
  }
  return Math.min(Math.floor(requested), UNLATCHED_LIMIT);
}

function latchKey(patientId: string, sourceReference: string): string {
  return `${patientId}\0${sourceReference}`;
}
