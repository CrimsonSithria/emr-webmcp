import { AdapterError, DraftStore, RegistrationManager, type EmrCapability } from '@emr-webmcp/core';
import { getSessionStore, openmrsFetch } from '@openmrs/esm-framework';

import {
  createO3OpenmrsAdapter,
  privilegesFromSession,
  wrapOpenmrsFetch,
  USE_PRIVILEGE,
} from '../openmrs/adapter-factory';
import { createDefaultCapabilityProbe } from '../openmrs/capability-probe';
import { bindReviewWorkspace, notifyReviewWorkspace } from '../review/review-workspace';
import { getDocumentModelContext } from './document-model-context';
import { createSessionCheckedRuntime, type SessionSnapshot } from './use-webmcp-registration';

type SessionStoreState = {
  loaded: boolean;
  session: { authenticated: boolean; user?: { uuid?: string } } | null;
};

let stop: (() => void) | null = null;

export function startWebmcpLifecycle(): void {
  if (stop !== null) {
    return;
  }
  stop = runWebmcpLifecycle();
}

export function stopWebmcpLifecycle(): void {
  if (stop === null) {
    return;
  }
  stop();
  stop = null;
}

function runWebmcpLifecycle(): () => void {
  const fetch = wrapOpenmrsFetch(openmrsFetch);
  let patientId = patientIdFromUrl();
  const adapter = createO3OpenmrsAdapter({
    fetch,
    getActivePatientId: () => patientId,
    canCreateFollowup: () => privileges.has(USE_PRIVILEGE),
  });

  let draftStore: DraftStore | null = null;
  let session: SessionSnapshot = { authenticated: false, userId: null };
  let privileges: ReadonlySet<string> = new Set();
  let capabilities: ReadonlySet<EmrCapability> = new Set();
  let routeContext = window.location.pathname;
  let previousUserId: string | null = null;
  let probeGeneration = 0;

  const runtime = createSessionCheckedRuntime({
    getAdapter: () => adapter,
    getSession: () => session,
    getPrivileges: () => privileges,
    getDraftStore: () => {
      if (draftStore === null) {
        throw unauthorizedStore();
      }
      return draftStore;
    },
    onDraftsChanged: notifyReviewWorkspace,
  });

  const model = getDocumentModelContext();
  const manager =
    model === null
      ? null
      : new RegistrationManager({
          modelContext: model,
          runtime,
          deps: {
            randomUUID: () => crypto.randomUUID(),
            now: () => new Date(),
            adapterId: adapter.id,
          },
        });

  const apply = (): void => {
    if (manager === null) {
      return;
    }
    if (!session.authenticated || session.userId === null) {
      manager.logout();
      dropStore();
      previousUserId = null;
      return;
    }
    if (draftStore === null) {
      draftStore = new DraftStore({
        userId: session.userId,
        now: () => new Date(),
        randomUUID: () => crypto.randomUUID(),
      });
    } else if (previousUserId !== null && previousUserId !== session.userId) {
      manager.userChange();
      draftStore.userChange(session.userId);
      notifyReviewWorkspace();
    }
    manager.update({
      userId: session.userId,
      privileges,
      capabilities,
      routeContext,
    });
    previousUserId = session.userId;
    notifyReviewWorkspace();
  };

  const dropStore = (): void => {
    if (draftStore === null) {
      return;
    }
    draftStore.logout();
    draftStore = null;
    notifyReviewWorkspace();
  };

  const refreshCapabilities = async (authenticated: boolean): Promise<void> => {
    const generation = ++probeGeneration;
    const next = await createDefaultCapabilityProbe({
      fetch,
      isAuthenticated: () => authenticated,
      getPatientId: () => patientId,
    })();
    if (generation !== probeGeneration) {
      return;
    }
    capabilities = next;
    apply();
  };

  const readSession = (): void => {
    const next = snapshotFromStore(getSessionStore().getState() as SessionStoreState);
    const authChanged = next.authenticated !== session.authenticated || next.userId !== session.userId;
    session = next;
    privileges = privilegesFromSession(next.authenticated);
    if (authChanged) {
      void refreshCapabilities(next.authenticated);
    }
    apply();
  };

  const onRoute = (): void => {
    patientId = patientIdFromUrl();
    const nextRoute = window.location.pathname;
    if (nextRoute === routeContext) {
      return;
    }
    routeContext = nextRoute;
    apply();
  };

  const unbindReview = bindReviewWorkspace({
    getStore: () => draftStore,
    getAdapter: () => adapter,
    getSession: () => session,
    getPrivileges: () => privileges,
  });

  readSession();
  const unsubscribe = getSessionStore().subscribe(readSession);
  window.addEventListener('single-spa:routing-event', onRoute);
  window.addEventListener('popstate', onRoute);

  return () => {
    probeGeneration += 1;
    unsubscribe();
    window.removeEventListener('single-spa:routing-event', onRoute);
    window.removeEventListener('popstate', onRoute);
    manager?.unmount();
    dropStore();
    unbindReview();
  };
}

function unauthorizedStore(): AdapterError {
  return new AdapterError('unauthorized', 'Not authorized to invoke this tool.', false);
}

function snapshotFromStore(state: SessionStoreState): SessionSnapshot {
  if (!state.loaded || state.session === null || !state.session.authenticated) {
    return { authenticated: false, userId: null };
  }
  const userId = state.session.user?.uuid;
  if (typeof userId !== 'string' || userId === '') {
    return { authenticated: false, userId: null };
  }
  return { authenticated: true, userId };
}

function patientIdFromUrl(): string | null {
  const match = /\/patient\/([a-zA-Z0-9-]+)/.exec(window.location.pathname);
  return match?.[1] ?? null;
}
