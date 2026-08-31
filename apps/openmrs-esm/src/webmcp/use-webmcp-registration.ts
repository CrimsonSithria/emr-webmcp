import {
  AdapterError,
  type ConfirmedFollowup,
  type DraftStore,
  type EmrAdapter,
  type FollowupDraft,
  type ToolName,
  type ToolRuntime,
} from '@emr-webmcp/core';

export type SessionSnapshot = {
  authenticated: boolean;
  userId: string | null;
};

export function createSessionCheckedRuntime(ports: {
  getAdapter: () => EmrAdapter;
  getSession: () => SessionSnapshot;
  getPrivileges: () => ReadonlySet<string>;
  getDraftStore: () => DraftStore;
  onDraftsChanged?: () => void;
}): ToolRuntime {
  const requireLive = (name: ToolName): void => {
    const session = ports.getSession();
    if (!session.authenticated || session.userId === null) {
      throw unauthorized();
    }
    const required = name === 'get_active_patient' ? 'session' : 'emr-webmcp.use';
    if (!ports.getPrivileges().has(required)) {
      throw unauthorized();
    }
  };

  return {
    get_active_patient: async () => {
      requireLive('get_active_patient');
      return ports.getAdapter().getActivePatient();
    },
    search_patients: async (input) => {
      requireLive('search_patients');
      const { query, limit } = input as { query: string; limit: number };
      return ports.getAdapter().searchPatients(query, limit);
    },
    list_clinic_appointments: async (input) => {
      requireLive('list_clinic_appointments');
      return ports.getAdapter().listAppointments(input as { start: string; end: string });
    },
    get_chart_brief: async (input) => {
      requireLive('get_chart_brief');
      return ports.getAdapter().getChartBrief((input as { patientId: string }).patientId);
    },
    find_unlatched_abnormal_results: async (input) => {
      requireLive('find_unlatched_abnormal_results');
      return ports.getAdapter().listAbnormalResults(input as { limit: number; patientId?: string; cursor?: string });
    },
    get_result_context: async (input) => {
      requireLive('get_result_context');
      const result = await ports.getAdapter().getResult((input as { resultId: string }).resultId);
      const followups = await ports.getAdapter().listFollowups({
        limit: 100,
        patientId: result.patient.id,
      });
      return {
        result,
        followups: followups.filter((item) => item.sourceReference === result.sourceReference),
      };
    },
    list_open_followups: async (input) => {
      requireLive('list_open_followups');
      return ports.getAdapter().listFollowups(input as { limit: number });
    },
    list_followup_assignees: async (input) => {
      requireLive('list_followup_assignees');
      const { query, limit } = input as { query: string; limit: number };
      return ports.getAdapter().listAssignees(query, limit);
    },
    stage_followup_task: async (input) => {
      requireLive('stage_followup_task');
      const draft = ports.getDraftStore().stage(toConfirmedInput(input as FollowupDraft));
      ports.onDraftsChanged?.();
      return { draftId: draft.draftId };
    },
    open_review_queue: async () => {
      requireLive('open_review_queue');
      await ports.getAdapter().navigate({ kind: 'review-queue' });
      return { opened: 'review-queue' };
    },
    open_patient_chart: async (input) => {
      requireLive('open_patient_chart');
      const { patientId } = input as { patientId: string };
      await ports.getAdapter().navigate({ kind: 'patient-chart', patientId });
      return { opened: 'patient-chart' };
    },
    open_result_or_followup: async (input) => {
      requireLive('open_result_or_followup');
      const target = input as
        | { kind: 'tests-dashboard'; patientId?: string }
        | { kind: 'task-workspace'; taskId: string };
      await ports.getAdapter().navigate(target);
      return { opened: target.kind };
    },
  };
}

function toConfirmedInput(input: FollowupDraft): ConfirmedFollowup {
  const confirmed: ConfirmedFollowup = {
    patient: input.patient,
    title: input.title,
    rationale: input.rationale,
    priority: input.priority,
  };
  if (input.dueAt !== undefined) {
    confirmed.dueAt = input.dueAt;
  }
  if (input.assignee !== undefined) {
    confirmed.assignee = input.assignee;
  }
  if (input.sourceReference !== undefined) {
    confirmed.sourceReference = input.sourceReference;
  }
  return confirmed;
}

function unauthorized(): AdapterError {
  return new AdapterError('unauthorized', 'Not authorized to invoke this tool.', false);
}
