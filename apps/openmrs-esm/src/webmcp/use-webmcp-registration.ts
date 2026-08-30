import {
  AdapterError,
  RegistrationManager,
  type EmrAdapter,
  type EmrCapability,
  type FollowupDraft,
  type ToolName,
  type ToolRuntime,
} from '@emr-webmcp/core';
import { useLayoutEffect, useRef } from 'react';

import { getDocumentModelContext } from './document-model-context';

export type SessionSnapshot = {
  authenticated: boolean;
  userId: string | null;
};

export type UseWebmcpRegistrationInput = {
  session: SessionSnapshot;
  privileges: ReadonlySet<string>;
  capabilities: ReadonlySet<EmrCapability>;
  routeContext: string;
  adapter: EmrAdapter;
};

export function useWebmcpRegistration(input: UseWebmcpRegistrationInput): void {
  const inputRef = useRef(input);
  inputRef.current = input;
  const draftsRef = useRef(new Map<string, FollowupDraft>());
  const previousUserId = useRef<string | null>(null);
  const managerRef = useRef<RegistrationManager | null>(null);
  const runtimeRef = useRef<ToolRuntime | null>(null);

  if (runtimeRef.current === null) {
    runtimeRef.current = createSessionCheckedRuntime({
      getAdapter: () => inputRef.current.adapter,
      getSession: () => inputRef.current.session,
      getPrivileges: () => inputRef.current.privileges,
      drafts: draftsRef.current,
    });
  }

  const authenticated = input.session.authenticated;
  const userId = input.session.userId;
  const privileges = input.privileges;
  const capabilities = input.capabilities;
  const routeContext = input.routeContext;

  useLayoutEffect(() => {
    const drafts = draftsRef.current;
    const model = getDocumentModelContext();
    if (model === null) {
      return undefined;
    }
    const manager = new RegistrationManager({
      modelContext: model,
      runtime: runtimeRef.current as ToolRuntime,
      deps: {
        randomUUID: () => crypto.randomUUID(),
        now: () => new Date(),
        adapterId: inputRef.current.adapter.id,
      },
    });
    managerRef.current = manager;
    return () => {
      manager.unmount();
      managerRef.current = null;
      drafts.clear();
    };
  }, []);

  useLayoutEffect(() => {
    const manager = managerRef.current;
    if (manager === null) {
      return;
    }

    if (!authenticated || userId === null) {
      manager.logout();
      draftsRef.current.clear();
      previousUserId.current = null;
      return;
    }

    if (previousUserId.current !== null && previousUserId.current !== userId) {
      manager.userChange();
      draftsRef.current.clear();
    }

    manager.update({
      userId,
      privileges,
      capabilities,
      routeContext,
    });
    previousUserId.current = userId;
  }, [authenticated, userId, privileges, capabilities, routeContext]);
}

export function createSessionCheckedRuntime(ports: {
  getAdapter: () => EmrAdapter;
  getSession: () => SessionSnapshot;
  getPrivileges: () => ReadonlySet<string>;
  drafts: Map<string, FollowupDraft>;
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
      const draft = input as FollowupDraft;
      ports.drafts.set(draft.draftId, draft);
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

function unauthorized(): AdapterError {
  return new AdapterError('unauthorized', 'Not authorized to invoke this tool.', false);
}
