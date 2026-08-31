import { AdapterError, type ConfirmedFollowup, type FollowupDraft, type FollowupSummary, type ResultSummary } from '@emr-webmcp/core';

export type ConfirmationPhase = 'idle' | 'validating' | 'ready' | 'committing' | 'succeeded' | 'failed';

export type DisabledReason =
  | 'stale-source'
  | 'patient-mismatch'
  | 'lost-privilege'
  | 'duplicate-active'
  | 'offline';

export type ConfirmationSnapshot = {
  phase: ConfirmationPhase;
  disabledReason: DisabledReason | null;
};

export type ConfirmationPorts = {
  peek: (draftId: string) => FollowupDraft;
  consume: (draftId: string) => FollowupDraft;
  getResult: (resultId: string) => Promise<ResultSummary>;
  listFollowups: (query: { limit: number; patientId: string }) => Promise<FollowupSummary[]>;
  createFollowup: (input: ConfirmedFollowup) => Promise<FollowupSummary>;
  isAuthenticated: () => boolean;
  hasUsePrivilege: () => boolean;
  isOnline: () => boolean;
};

export type ConfirmationController = {
  snapshot: () => ConfirmationSnapshot;
  subscribe: (listener: (snapshot: ConfirmationSnapshot) => void) => () => void;
  validate: (draftId: string) => Promise<ConfirmationSnapshot>;
  confirm: (draftId: string) => Promise<ConfirmationSnapshot>;
};

export function createConfirmationController(ports: ConfirmationPorts): ConfirmationController {
  let phase: ConfirmationPhase = 'idle';
  let disabledReason: DisabledReason | null = null;
  const listeners = new Set<(snapshot: ConfirmationSnapshot) => void>();

  const snapshot = (): ConfirmationSnapshot => ({ phase, disabledReason });

  const emit = (): void => {
    const current = snapshot();
    for (const listener of listeners) {
      listener(current);
    }
  };

  const busy = (): boolean => phase === 'validating' || phase === 'committing';

  const validate = async (draftId: string): Promise<ConfirmationSnapshot> => {
    if (busy()) {
      return snapshot();
    }
    phase = 'validating';
    disabledReason = null;
    emit();

    const reason = await resolveDisabledReason(ports, draftId);
    disabledReason = reason;
    phase = reason === null ? 'ready' : 'idle';
    emit();
    return snapshot();
  };

  const confirm = async (draftId: string): Promise<ConfirmationSnapshot> => {
    if (busy() || phase !== 'ready') {
      return snapshot();
    }
    phase = 'committing';
    emit();

    try {
      const draft = ports.peek(draftId);
      await ports.createFollowup(toConfirmed(draft));
      ports.consume(draftId);
      phase = 'succeeded';
    } catch {
      phase = 'failed';
    }
    emit();
    return snapshot();
  };

  return {
    snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    validate,
    confirm,
  };
}

export function toConfirmed(draft: FollowupDraft): ConfirmedFollowup {
  const confirmed: ConfirmedFollowup = {
    patient: draft.patient,
    title: draft.title,
    rationale: draft.rationale,
    priority: draft.priority,
  };
  if (draft.dueAt !== undefined) {
    confirmed.dueAt = draft.dueAt;
  }
  if (draft.assignee !== undefined) {
    confirmed.assignee = draft.assignee;
  }
  if (draft.sourceReference !== undefined) {
    confirmed.sourceReference = draft.sourceReference;
  }
  return confirmed;
}

export function observationIdFromSource(sourceReference: string): string | undefined {
  const match = /^Observation\/([A-Za-z0-9._-]+)$/.exec(sourceReference);
  const id = match?.[1];
  return id === undefined || id === '' ? undefined : id;
}

async function resolveDisabledReason(ports: ConfirmationPorts, draftId: string): Promise<DisabledReason | null> {
  if (ports.isOnline() === false) {
    return 'offline';
  }
  if (ports.isAuthenticated() === false || ports.hasUsePrivilege() === false) {
    return 'lost-privilege';
  }

  const draft = ports.peek(draftId);
  if (draft.sourceReference === undefined || draft.sourceReference === '') {
    return null;
  }

  const resultId = observationIdFromSource(draft.sourceReference);
  if (resultId === undefined) {
    return 'stale-source';
  }

  let result: ResultSummary;
  try {
    result = await ports.getResult(resultId);
  } catch (error) {
    if (error instanceof AdapterError && error.code === 'not-found') {
      return 'stale-source';
    }
    return 'stale-source';
  }

  if (result.patient.id !== draft.patient.id) {
    return 'patient-mismatch';
  }

  try {
    const followups = await ports.listFollowups({
      limit: 100,
      patientId: draft.patient.id,
    });
    const duplicate = followups.some(
      (item) =>
        item.sourceReference === draft.sourceReference &&
        (item.status === 'not-started' || item.status === 'in-progress'),
    );
    if (duplicate) {
      return 'duplicate-active';
    }
  } catch {
    return null;
  }

  return null;
}
