import { useEffect, useState } from 'react';
import type { DraftStore, EmrAdapter, FollowupDraft } from '@emr-webmcp/core';

import { USE_PRIVILEGE } from '../openmrs/adapter-factory';
import type { SessionSnapshot } from '../webmcp/use-webmcp-registration';
import type { ConfirmationPorts } from './confirmation-controller';

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
const listeners = new Set<() => void>();

export function bindReviewWorkspace(ports: ReviewWorkspacePorts): () => void {
  bound = ports;
  notifyReviewWorkspace();
  return () => {
    if (bound === ports) {
      bound = null;
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
  const session = bound.getSession();
  const privileges = bound.getPrivileges();
  const drafts =
    store === null ? [] : store.diagnostics().draftIds.map((draftId) => store.peek(draftId));

  if (store === null) {
    return { drafts: [], adapterId: adapter.id, ports: null };
  }

  const ports: ConfirmationPorts = {
    peek: (draftId) => store.peek(draftId),
    consume: (draftId) => {
      const draft = store.consume(draftId);
      notifyReviewWorkspace();
      return draft;
    },
    getResult: (resultId) => adapter.getResult(resultId),
    listFollowups: (query) => adapter.listFollowups(query),
    createFollowup: (input) => adapter.createFollowup(input),
    isAuthenticated: () => session.authenticated && session.userId !== null,
    hasUsePrivilege: () => privileges.has(USE_PRIVILEGE),
    isOnline: () => navigator.onLine,
  };

  return { drafts, adapterId: adapter.id, ports };
}
