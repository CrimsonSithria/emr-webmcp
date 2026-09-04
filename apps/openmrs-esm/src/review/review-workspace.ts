import { AdapterError, type DraftStore, type EmrAdapter, type FollowupDraft } from '@emr-webmcp/core';
import { useEffect, useState } from 'react';

import { USE_PRIVILEGE } from '../openmrs/adapter-factory';
import { recordConfirmedFollowup } from '../webmcp/agent-activity';
import type { SessionSnapshot } from '../webmcp/use-webmcp-registration';
import { releaseConfirmationController, type ConfirmationPorts } from './confirmation-controller';

export type ReviewWorkspacePorts = {
  getStore: () => DraftStore | null;
  getAdapter: () => EmrAdapter;
  getSession: () => SessionSnapshot;
  getPrivileges: () => ReadonlySet<string>;
};

export type ReviewWorkspaceView = {
  drafts: FollowupDraft[];
  adapterId: string;
  ports: ConfirmationPorts | null;
};

let bound: ReviewWorkspacePorts | null = null;
let sessionPorts: ConfirmationPorts | null = null;
const listeners = new Set<() => void>();

export function bindReviewWorkspace(ports: ReviewWorkspacePorts): () => void {
  bound = ports;
  sessionPorts = null;
  notifyReviewWorkspace();
  return () => {
    if (bound === ports) {
      bound = null;
      sessionPorts = null;
      notifyReviewWorkspace();
    }
  };
}

export function getReviewWorkspacePorts(): ReviewWorkspacePorts | null {
  return bound;
}

export function subscribeReviewWorkspace(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyReviewWorkspace(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function useReviewWorkspace(): ReviewWorkspaceView {
  const [, setTick] = useState(0);
  useEffect(() => subscribeReviewWorkspace(() => setTick((value) => value + 1)), []);
  return readReviewWorkspace();
}

export function readReviewWorkspace(): ReviewWorkspaceView {
  if (bound === null) {
    return { drafts: [], adapterId: 'openmrs', ports: null };
  }

  const store = bound.getStore();
  const adapter = bound.getAdapter();
  if (store === null) {
    return { drafts: [], adapterId: adapter.id, ports: null };
  }

  const drafts = store.diagnostics().draftIds.map((draftId) => store.peek(draftId));
  return { drafts, adapterId: adapter.id, ports: livePorts() };
}

function livePorts(): ConfirmationPorts | null {
  if (bound === null || bound.getStore() === null) {
    sessionPorts = null;
    return null;
  }
  if (sessionPorts !== null) {
    return sessionPorts;
  }
  sessionPorts = {
    peek: (draftId) => requireStore().peek(draftId),
    consume: (draftId) => {
      const draft = requireStore().consume(draftId);
      recordConfirmedFollowup({ patient: draft.patient.display, title: draft.title });
      releaseConfirmationController(draftId);
      notifyReviewWorkspace();
      return draft;
    },
    getResult: (resultId) => requireBound().getAdapter().getResult(resultId),
    listFollowups: (query) => requireBound().getAdapter().listFollowups(query),
    createFollowup: (input) => requireBound().getAdapter().createFollowup(input),
    isAuthenticated: () => {
      const session = requireBound().getSession();
      return session.authenticated && session.userId !== null;
    },
    hasUsePrivilege: () => requireBound().getPrivileges().has(USE_PRIVILEGE),
    isOnline: () => navigator.onLine,
  };
  return sessionPorts;
}

function requireBound(): ReviewWorkspacePorts {
  if (bound === null) {
    throw new AdapterError('not-found', 'Review workspace is not bound.', false);
  }
  return bound;
}

function requireStore(): DraftStore {
  const store = requireBound().getStore();
  if (store === null) {
    throw new AdapterError('not-found', 'Draft store is not available.', false);
  }
  return store;
}
