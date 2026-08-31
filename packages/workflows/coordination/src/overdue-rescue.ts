import type { EmrAdapter, FollowupQuery, FollowupSummary } from '@emr-webmcp/core';

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;
const DEFAULT_LIMIT = 100;

export type OverdueRescueInput = {
  patientId?: string;
  assigneeId?: string;
  priority?: FollowupSummary['priority'];
  limit?: number;
};

export type OverdueRescueResult = {
  followups: FollowupSummary[];
};

export async function overdueRescue(
  adapter: EmrAdapter,
  input: OverdueRescueInput = {},
): Promise<OverdueRescueResult> {
  const limit = resolveLimit(input.limit);
  const query: FollowupQuery = { limit, overdueOnly: true };
  if (input.patientId !== undefined) {
    query.patientId = input.patientId;
  }
  if (input.assigneeId !== undefined) {
    query.assigneeId = input.assigneeId;
  }
  if (input.priority !== undefined) {
    query.priority = input.priority;
  }

  const followups = (await adapter.listFollowups(query))
    .filter((item) => item.status === 'not-started' || item.status === 'in-progress')
    .filter((item) => (input.patientId === undefined ? true : item.patient.id === input.patientId))
    .sort(compareOverdue);

  return { followups };
}

function resolveLimit(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested) || requested < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.floor(requested);
}

function compareOverdue(left: FollowupSummary, right: FollowupSummary): number {
  const byPriority = PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority];
  if (byPriority !== 0) {
    return byPriority;
  }
  const leftDue = left.dueAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(left.dueAt);
  const rightDue = right.dueAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(right.dueAt);
  if (leftDue !== rightDue) {
    return leftDue - rightDue;
  }
  return left.id.localeCompare(right.id);
}
