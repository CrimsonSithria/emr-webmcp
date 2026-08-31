import {
  AdapterError,
  DraftStore,
  RegistrationManager,
  type ConfirmedFollowup,
  type EmrAdapter,
  type EmrCapability,
  type FollowupDraft,
  type FollowupSummary,
  type ResultSummary,
  type ToolResult,
} from '@emr-webmcp/core';

import {
  createConfirmationController,
  type ConfirmationPorts,
} from '../../../apps/openmrs-esm/src/review/confirmation-controller';
import {
  createSessionCheckedRuntime,
  type SessionSnapshot,
} from '../../../apps/openmrs-esm/src/webmcp/use-webmcp-registration';
import type { ReviewHarness } from '../fixtures/harness-globals';
import { installFakeModelContext } from '../fixtures/model-context';

const ALL_CAPABILITIES: readonly EmrCapability[] = [
  'search-patients',
  'list-appointments',
  'get-chart-brief',
  'list-abnormal-results',
  'get-result',
  'list-followups',
  'list-assignees',
  'create-followup',
  'navigate-patient-chart',
  'navigate-tests',
  'navigate-tasks',
  'navigate-review-queue',
];

const SOURCE: ResultSummary = {
  id: 'obs-1',
  patient: { id: 'patient-1', display: 'Ada Lovelace' },
  name: 'Potassium',
  observedAt: '2026-08-31T04:00:00.000Z',
  interpretation: 'high',
  sourceReference: 'Observation/obs-1',
};

type NetworkRequest = { method: string; url: string };

const requests: NetworkRequest[] = [];
const created: FollowupSummary[] = [];
const navigations: unknown[] = [];

const originalFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? 'GET').toUpperCase();
  requests.push({ method, url });
  if (method === 'POST' && url.includes('/ws/rest/v1/tasks/careplan')) {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as ConfirmedFollowup) : undefined;
    const id = `task-${created.length + 1}`;
    const summary: FollowupSummary = {
      id,
      patient: body?.patient ?? SOURCE.patient,
      title: body?.title ?? 'Follow up',
      status: 'not-started',
      priority: body?.priority ?? 'high',
    };
    if (body?.sourceReference !== undefined) {
      summary.sourceReference = body.sourceReference;
    }
    created.push(summary);
    return new Response(JSON.stringify(summary), { status: 201 });
  }
  return originalFetch(input, init);
};

const adapter: EmrAdapter = {
  id: 'openmrs',
  getCapabilities: () => Promise.resolve(new Set(ALL_CAPABILITIES)),
  getActivePatient: () => Promise.resolve(SOURCE.patient),
  searchPatients: () => Promise.resolve([SOURCE.patient]),
  listAppointments: () => Promise.resolve([]),
  getChartBrief: () =>
    Promise.resolve({
      patient: SOURCE.patient,
      conditions: [],
      allergies: [],
      medications: [],
      recentVitals: [],
      recentResults: [SOURCE],
      openTasks: created.filter((item) => item.status === 'not-started' || item.status === 'in-progress'),
    }),
  listAbnormalResults: () => Promise.resolve([SOURCE]),
  getResult: (resultId) => {
    if (resultId !== SOURCE.id) {
      return Promise.reject(new AdapterError('not-found', 'Result was not found.', false));
    }
    return Promise.resolve(SOURCE);
  },
  listFollowups: () => Promise.resolve([...created]),
  listAssignees: () => Promise.resolve([]),
  createFollowup: async (input) => {
    const duplicate = created.some(
      (item) =>
        item.sourceReference === input.sourceReference &&
        (item.status === 'not-started' || item.status === 'in-progress'),
    );
    if (duplicate) {
      throw new AdapterError('conflict', 'An active follow-up already exists for this source.', false);
    }
    const response = await fetch('/ws/rest/v1/tasks/careplan', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return (await response.json()) as FollowupSummary;
  },
  navigate: (target) => {
    navigations.push(target);
    return Promise.resolve();
  },
};

const model = installFakeModelContext();
let store = new DraftStore({
  userId: 'user-1',
  now: () => new Date(),
  randomUUID: () => crypto.randomUUID(),
});
let session: SessionSnapshot = { authenticated: true, userId: 'user-1' };
let privileges: ReadonlySet<string> = new Set(['session', 'emr-webmcp.use']);
let routeContext = '/emr-webmcp';
let previousUserId: string | null = 'user-1';

const runtime = createSessionCheckedRuntime({
  getAdapter: () => adapter,
  getSession: () => session,
  getPrivileges: () => privileges,
  getDraftStore: () => store,
  onDraftsChanged: renderQueue,
});

const manager = new RegistrationManager({
  modelContext: model,
  runtime,
  deps: {
    randomUUID: () => crypto.randomUUID(),
    now: () => new Date(),
    adapterId: adapter.id,
  },
});

function apply(): void {
  if (!session.authenticated || session.userId === null) {
    manager.logout();
    store.logout();
    renderQueue();
    previousUserId = null;
    return;
  }
  if (previousUserId !== null && previousUserId !== session.userId) {
    manager.userChange();
    store.userChange(session.userId);
  }
  manager.update({
    userId: session.userId,
    privileges,
    capabilities: new Set(ALL_CAPABILITIES),
    routeContext,
  });
  previousUserId = session.userId;
  renderQueue();
}

function renderQueue(): void {
  const root = document.getElementById('review-queue');
  if (root === null) {
    return;
  }
  root.replaceChildren();
  for (const draft of store.diagnostics().draftIds.map((draftId) => store.peek(draftId))) {
    root.append(renderItem(draft));
  }
}

function renderItem(draft: FollowupDraft): HTMLElement {
  const ports: ConfirmationPorts = {
    peek: (draftId) => store.peek(draftId),
    consume: (draftId) => store.consume(draftId),
    getResult: (resultId) => adapter.getResult(resultId),
    listFollowups: (query) => adapter.listFollowups(query),
    createFollowup: (input) => adapter.createFollowup(input),
    isAuthenticated: () => session.authenticated && session.userId !== null,
    hasUsePrivilege: () => privileges.has('emr-webmcp.use'),
    isOnline: () => navigator.onLine,
  };
  const controller = createConfirmationController(ports);

  const item = document.createElement('article');
  item.dataset.testid = 'review-item';
  item.dataset.draftId = draft.draftId;
  item.innerHTML = `
    <p data-testid="review-item-patient">${escapeHtml(draft.patient.display)} (${escapeHtml(draft.patient.id)})</p>
    <p data-testid="review-item-source">${escapeHtml(draft.sourceReference ?? '')}</p>
    <p data-testid="review-item-title">${escapeHtml(draft.title)}</p>
    <p data-testid="review-item-rationale">${escapeHtml(draft.rationale)}</p>
    <p data-testid="review-item-assignee">${escapeHtml(draft.assignee?.display ?? '')}</p>
    <p data-testid="review-item-priority">${escapeHtml(draft.priority)}</p>
    <p data-testid="review-item-due-at">${escapeHtml(draft.dueAt ?? '')}</p>
    <p data-testid="review-item-provenance">emr-webmcp / ${escapeHtml(adapter.id)}</p>
  `;

  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.testid = 'confirm-followup';
  button.textContent = 'Confirm follow-up';
  const syncButton = (): void => {
    const snapshot = controller.snapshot();
    button.disabled = snapshot.phase !== 'ready';
    if (snapshot.disabledReason === null) {
      delete button.dataset.disabledReason;
    } else {
      button.dataset.disabledReason = snapshot.disabledReason;
    }
    button.dataset.confirmationState = snapshot.phase;
  };
  controller.subscribe(syncButton);
  button.addEventListener('click', () => {
    void controller.confirm(draft.draftId);
  });
  item.append(button);
  void controller.validate(draft.draftId).then(syncButton);
  return item;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function invokeTool(name: string, input: unknown): Promise<ToolResult<unknown>> {
  const tool = model.tool(name);
  return (await tool.execute(input, new AbortController().signal)) as ToolResult<unknown>;
}

apply();

const harness: ReviewHarness = {
  writeMethods(): string[] {
    return requests
      .map((entry) => entry.method)
      .filter((method) => method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE');
  },
  carePlanPosts(): NetworkRequest[] {
    return requests.filter(
      (entry) => entry.method === 'POST' && entry.url.includes('/ws/rest/v1/tasks/careplan'),
    );
  },
  requests(): NetworkRequest[] {
    return [...requests];
  },
  createdCount(): number {
    return created.length;
  },
  navigations(): unknown[] {
    return [...navigations];
  },
  toolNames(): string[] {
    return model.names();
  },
  unregisterCount(): number {
    return model.unregisterLog.length;
  },
  invoke: invokeTool,
  authenticate(userId: string): void {
    session = { authenticated: true, userId };
    privileges = new Set(['session', 'emr-webmcp.use']);
    if (store.diagnostics().count === 0 && previousUserId === null) {
      store = new DraftStore({
        userId,
        now: () => new Date(),
        randomUUID: () => crypto.randomUUID(),
      });
    }
    apply();
  },
  logout(): void {
    session = { authenticated: false, userId: null };
    privileges = new Set();
    apply();
  },
  changeUser(userId: string): void {
    session = { authenticated: true, userId };
    privileges = new Set(['session', 'emr-webmcp.use']);
    apply();
  },
  changeRoute(path: string): void {
    routeContext = path;
    apply();
  },
  unmount(): void {
    manager.unmount();
    store.logout();
    renderQueue();
  },
};

window.__harness = harness;
window.__modelContext = model;
