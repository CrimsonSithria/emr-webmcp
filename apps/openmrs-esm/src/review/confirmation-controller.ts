import {
  AdapterError,
  type ConfirmedFollowup,
  type FollowupDraft,
  type FollowupSummary,
  type ResultSummary,
  type ToolErrorCode,
} from '@emr-webmcp/core';

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
  error: ToolErrorCode | null;
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

const controllers = new Map<string, ConfirmationController>();

export function getOrCreateConfirmationController(
  draftId: string,
  ports: ConfirmationPorts,
): ConfirmationController {
  const existing = controllers.get(draftId);
  if (existing !== undefined) {
    return existing;
  }
  const created = createConfirmationController(ports);
  controllers.set(draftId, created);
  return created;
}

export function releaseConfirmationController(draftId: string): void {
  controllers.delete(draftId);
}

export function resetConfirmationControllers(): void {
  controllers.clear();
}

export function createConfirmationController(ports: ConfirmationPorts): ConfirmationController {
  let phase: ConfirmationPhase = 'idle';
  let disabledReason: DisabledReason | null = null;
  let error: ToolErrorCode | null = null;
  const listeners = new Set<(snapshot: ConfirmationSnapshot) => void>();

  const snapshot = (): ConfirmationSnapshot => ({ phase, disabledReason, error });

  const emit = (): void => {
    const current = snapshot();
    for (const listener of listeners) {
      listener(current);
    }
  };

  const busy = (): boolean => phase === 'validating' || phase === 'committing';

  const fail = (code: ToolErrorCode): ConfirmationSnapshot => {
    phase = 'failed';
    error = code;
    emit();
    return snapshot();
  };

  const validate = async (draftId: string): Promise<ConfirmationSnapshot> => {
    if (busy() || phase === 'succeeded') {
      return snapshot();
    }
    phase = 'validating';
    disabledReason = null;
    error = null;
    emit();

    try {
      const reason = await resolveDisabledReason(ports, draftId);
      disabledReason = reason;
      phase = reason === null ? 'ready' : 'idle';
    } catch (caught) {
      return fail(errorCodeOf(caught));
    }
    emit();
    return snapshot();
  };

  const confirm = async (draftId: string): Promise<ConfirmationSnapshot> => {
    if (busy()) {
      return snapshot();
    }
    if (phase === 'failed') {
      const validated = await validate(draftId);
      if (validated.phase !== 'ready') {
        return validated;
      }
    } else if (phase !== 'ready') {
      return snapshot();
    }

    phase = 'committing';
    emit();

    try {
      const reason = await resolveDisabledReason(ports, draftId);
      if (reason !== null) {
        disabledReason = reason;
        error = null;
        phase = 'idle';
        emit();
        return snapshot();
      }
      const draft = ports.peek(draftId);
      await ports.createFollowup(toConfirmed(draft));
      ports.consume(draftId);
      phase = 'succeeded';
      disabledReason = null;
      error = null;
    } catch (caught) {
      return fail(errorCodeOf(caught));
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

function errorCodeOf(caught: unknown): ToolErrorCode {
  if (caught instanceof AdapterError) {
    return caught.code;
  }
  return 'upstream';
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
  } catch (caught) {
    if (caught instanceof AdapterError && caught.code === 'not-found') {
      return 'stale-source';
    }
    throw caught;
  }

  if (result.patient.id !== draft.patient.id) {
    return 'patient-mismatch';
  }

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

  return null;
}
