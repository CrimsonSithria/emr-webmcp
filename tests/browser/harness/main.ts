import {
  AdapterError,
  DraftStore,
  RegistrationManager,
  type AppointmentSummary,
  type AssigneeSummary,
  type ConfirmedFollowup,
  type EmrAdapter,
  type EmrCapability,
  type FollowupDraft,
  type FollowupSummary,
  type PatientRef,
  type ResultSummary,
  type ToolResult,
} from '@emr-webmcp/core';

import {
  getOrCreateConfirmationController,
  type ConfirmationPorts,
} from '../../../apps/openmrs-esm/src/review/confirmation-controller';
import {
  createSessionCheckedRuntime,
  type SessionSnapshot,
} from '../../../apps/openmrs-esm/src/webmcp/use-webmcp-registration';
import type { ClinicProfileName, ReviewHarness } from '../fixtures/harness-globals';
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

const CRITICAL_SOURCE: ResultSummary = {
  id: 'obs-critical-1',
  patient: { id: 'patient-1', display: 'Ada Lovelace' },
  name: 'analyte-critical',
  observedAt: '2026-08-31T04:05:00.000Z',
  interpretation: 'critical-high',
  sourceReference: 'Observation/obs-critical-1',
};

const DEFAULT_CONFIRMED: ConfirmedFollowup = {
  patient: SOURCE.patient,
  title: 'Follow up potassium',
  rationale: 'Repeat the BMP in clinic after the high potassium result.',
  priority: 'high',
  dueAt: '2026-09-01T09:00:00.000Z',
  assignee: { id: 'person-dr-chen', display: 'Dr. Chen', type: 'person' },
  sourceReference: 'Observation/obs-1',
};

type NetworkRequest = { method: string; url: string };

type ClinicState = {
  profile: ClinicProfileName;
  patients: PatientRef[];
  appointments: AppointmentSummary[];
  results: ResultSummary[];
  assignees: AssigneeSummary[];
  activePatient: PatientRef | null;
};

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

function buildClinic(profile: ClinicProfileName): ClinicState {
  if (profile === 'empty') {
    return {
      profile,
      patients: [],
      appointments: [],
      results: [],
      assignees: [],
      activePatient: null,
    };
  }
  if (profile === 'large') {
    const patients = Array.from({ length: 80 }, (_, index) => {
      const ordinal = String(index + 1).padStart(3, '0');
      return { id: `patient-syn-${ordinal}`, display: `Synthetic ${ordinal}` };
    });
    const results = Array.from({ length: 100 }, (_, index) => {
      const interpretations = ['high', 'critical-high', 'low', 'critical-low', 'normal'] as const;
      const interpretation = interpretations[index % interpretations.length] ?? 'high';
      const patient = patients[index % patients.length] ?? patients[0];
      const ordinal = String(index + 1).padStart(3, '0');
      return {
        id: `obs-syn-${ordinal}`,
        patient: patient ?? { id: `patient-syn-${ordinal}`, display: `Synthetic ${ordinal}` },
        name: `analyte-${ordinal}`,
        observedAt: '2026-08-31T04:00:00.000Z',
        interpretation,
        sourceReference: `Observation/obs-syn-${ordinal}`,
      };
    });
    const appointments = Array.from({ length: 40 }, (_, index) => {
      const ordinal = String(index + 1).padStart(3, '0');
      const patient = patients[index % patients.length] ?? patients[0];
      return {
        id: `appt-syn-${ordinal}`,
        patient: patient ?? { id: `patient-syn-${ordinal}`, display: `Synthetic ${ordinal}` },
        start: '2026-08-31T09:00:00.000Z',
        status: 'scheduled' as const,
      };
    });
    return {
      profile,
      patients,
      appointments,
      results,
      assignees: [{ id: 'person-syn-001', display: 'Synthetic Clinician', type: 'person' }],
      activePatient: patients[0] ?? null,
    };
  }
  return {
    profile,
    patients: [SOURCE.patient],
    appointments: [],
    results: [SOURCE, CRITICAL_SOURCE],
    assignees: [{ id: 'person-dr-chen', display: 'Dr. Chen', type: 'person' }],
    activePatient: SOURCE.patient,
  };
}

let clinic = buildClinic('default');
let capabilities: Set<EmrCapability> = new Set(ALL_CAPABILITIES);
let online = true;
let shownPatients: PatientRef[] = [];

const adapter: EmrAdapter = {
  id: 'openmrs',
  getCapabilities: () => Promise.resolve(new Set(capabilities)),
  getActivePatient: () => Promise.resolve(clinic.activePatient),
  searchPatients: (query, limit) => {
    const needle = query.trim().toLowerCase();
    const matches = clinic.patients.filter(
      (patient) => patient.id.toLowerCase().includes(needle) || patient.display.toLowerCase().includes(needle),
    );
    return Promise.resolve(matches.slice(0, limit));
  },
  listAppointments: () => Promise.resolve([...clinic.appointments]),
  getChartBrief: (patientId) => {
    const patient = clinic.patients.find((item) => item.id === patientId);
    if (patient === undefined) {
      return Promise.reject(new AdapterError('not-found', 'Patient was not found.', false));
    }
    const recentResults = clinic.results.filter((item) => item.patient.id === patientId);
    return Promise.resolve({
      patient,
      conditions: [],
      allergies: [],
      medications: [],
      recentVitals: [],
      recentResults,
      openTasks: created.filter(
        (item) =>
          item.patient.id === patientId && (item.status === 'not-started' || item.status === 'in-progress'),
      ),
    });
  },
  listAbnormalResults: (input) => {
    const abnormal = clinic.results.filter((item) => {
      if (item.interpretation === 'normal') {
        return false;
      }
      return input.patientId === undefined || item.patient.id === input.patientId;
    });
    return Promise.resolve(abnormal.slice(0, input.limit));
  },
  getResult: (resultId) => {
    const found = clinic.results.find((item) => item.id === resultId);
    if (found === undefined) {
      return Promise.reject(new AdapterError('not-found', 'Result was not found.', false));
    }
    return Promise.resolve(found);
  },
  listFollowups: (query) => {
    const items = created.filter((item) => query.patientId === undefined || item.patient.id === query.patientId);
    return Promise.resolve(items.slice(0, query.limit));
  },
  listAssignees: (query, limit) => {
    const needle = query.trim().toLowerCase();
    const matches = clinic.assignees.filter(
      (item) => item.id.toLowerCase().includes(needle) || item.display.toLowerCase().includes(needle),
    );
    return Promise.resolve(matches.slice(0, limit));
  },
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
    renderClinic();
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
    capabilities,
    routeContext,
  });
  previousUserId = session.userId;
  renderQueue();
  renderClinic();
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

const ports: ConfirmationPorts = {
  peek: (draftId) => store.peek(draftId),
  consume: (draftId) => store.consume(draftId),
  getResult: (resultId) => adapter.getResult(resultId),
  listFollowups: (query) => adapter.listFollowups(query),
  createFollowup: (input) => adapter.createFollowup(input),
  isAuthenticated: () => session.authenticated && session.userId !== null,
  hasUsePrivilege: () => privileges.has('emr-webmcp.use'),
  isOnline: () => online,
};

function renderItem(draft: FollowupDraft): HTMLElement {
  const controller = getOrCreateConfirmationController(draft.draftId, ports);

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

function replaceList(testId: string, labels: readonly string[]): void {
  const root = document.querySelector(`[data-testid="${testId}"]`);
  if (!(root instanceof HTMLElement)) {
    return;
  }
  root.replaceChildren();
  for (const label of labels) {
    const item = document.createElement('li');
    item.textContent = label;
    root.append(item);
  }
}

function setText(testId: string, value: string): void {
  const node = document.querySelector(`[data-testid="${testId}"]`);
  if (node instanceof HTMLElement) {
    node.textContent = value;
  }
}

function renderClinic(): void {
  setText('clinic-profile', clinic.profile);
  setText(
    'clinic-counts',
    `patients=${clinic.patients.length} appointments=${clinic.appointments.length} results=${clinic.results.length} shown=${shownPatients.length}`,
  );
  setText('auth-state', session.authenticated && session.userId !== null ? 'signed-in' : 'signed-out');
  setText('active-patient', clinic.activePatient?.id ?? 'none');
  const unsupported = document.querySelector('[data-testid="unsupported-note"]');
  if (unsupported instanceof HTMLElement) {
    unsupported.hidden = capabilities.has('search-patients');
  }
  replaceList(
    'patient-search-results',
    shownPatients.map((patient) => patient.id),
  );
  replaceList(
    'appointment-list',
    clinic.appointments.map((item) => item.id),
  );
  replaceList(
    'abnormal-results',
    clinic.results.filter((item) => item.interpretation !== 'normal').map((item) => `${item.id}:${item.interpretation}`),
  );
  replaceList(
    'followup-list',
    created.map((item) => item.id),
  );
  replaceList(
    'assignee-list',
    clinic.assignees.map((item) => item.id),
  );
}

async function refreshClinicPanel(): Promise<void> {
  const active = await adapter.getActivePatient();
  setText('active-patient', active?.id ?? 'none');
  if (active !== null) {
    try {
      const brief = await adapter.getChartBrief(active.id);
      setText('chart-brief', `results=${brief.recentResults.length}`);
    } catch {
      setText('chart-brief', 'empty');
    }
  } else {
    setText('chart-brief', 'empty');
  }
  const appointments = await adapter.listAppointments({
    start: '2026-08-31T00:00:00.000Z',
    end: '2026-09-06T23:59:59.000Z',
  });
  const abnormal = await adapter.listAbnormalResults({ limit: 100 });
  const followups = await adapter.listFollowups({ limit: 100 });
  const assignees = await adapter.listAssignees('person', 20);
  replaceList(
    'appointment-list',
    appointments.map((item) => item.id),
  );
  replaceList(
    'abnormal-results',
    abnormal.map((item) => `${item.id}:${item.interpretation}`),
  );
  replaceList(
    'followup-list',
    followups.map((item) => item.id),
  );
  replaceList(
    'assignee-list',
    assignees.map((item) => item.id),
  );
}

async function invokeTool(name: string, input: unknown): Promise<ToolResult<unknown>> {
  try {
    const tool = model.tool(name);
    return (await tool.execute(input, new AbortController().signal)) as ToolResult<unknown>;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('tool ')) {
      return {
        ok: false,
        error: { code: 'unsupported', message: 'Capability is not available.', retryable: false },
        meta: {
          invocationId: crypto.randomUUID(),
          adapterId: adapter.id,
          generatedAt: new Date().toISOString(),
          truncated: false,
        },
      };
    }
    throw error;
  }
}

function bindUi(): void {
  document.querySelector('[data-testid="patient-search-submit"]')?.addEventListener('click', () => {
    const input = document.querySelector('[data-testid="patient-search"]');
    const query = input instanceof HTMLInputElement ? input.value : 'patient';
    void adapter.searchPatients(query, 20).then((patients) => {
      shownPatients = patients;
      renderClinic();
    });
  });
  document.querySelector('[data-testid="refresh-reads"]')?.addEventListener('click', () => {
    void refreshClinicPanel();
  });
  document.querySelector('[data-testid="navigate-chart"]')?.addEventListener('click', () => {
    const patientId = clinic.activePatient?.id ?? clinic.patients[0]?.id;
    if (patientId === undefined) {
      return;
    }
    void adapter.navigate({ kind: 'patient-chart', patientId });
  });
  document.querySelector('[data-testid="navigate-review"]')?.addEventListener('click', () => {
    void adapter.navigate({ kind: 'review-queue' });
  });
  document.querySelector('[data-testid="stage-followup"]')?.addEventListener('click', () => {
    store.stage(DEFAULT_CONFIRMED);
    renderQueue();
  });
  document.querySelector('[data-testid="logout"]')?.addEventListener('click', () => {
    session = { authenticated: false, userId: null };
    privileges = new Set();
    apply();
  });
  document.querySelector('[data-testid="apply-route"]')?.addEventListener('click', () => {
    const input = document.querySelector('[data-testid="route-input"]');
    routeContext = input instanceof HTMLInputElement ? input.value : '/emr-webmcp';
    apply();
  });
}

apply();
bindUi();

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
  setClinicProfile(profile: ClinicProfileName): void {
    clinic = buildClinic(profile);
    shownPatients = [];
    renderClinic();
  },
  setCapabilities(names: string[]): void {
    capabilities = new Set(names as EmrCapability[]);
    apply();
  },
  setPrivileges(names: string[]): void {
    privileges = new Set(names);
    apply();
  },
  setOnline(next: boolean): void {
    online = next;
    window.dispatchEvent(new Event(next ? 'online' : 'offline'));
    renderQueue();
  },
  addResult(result: ResultSummary): void {
    clinic.results = [...clinic.results, result];
    renderClinic();
  },
  removeResult(resultId: string): void {
    clinic.results = clinic.results.filter((item) => item.id !== resultId);
    renderQueue();
    renderClinic();
  },
  refreshClinic(): Promise<void> {
    return refreshClinicPanel();
  },
  clinicCounts(): { patients: number; appointments: number; results: number; shownPatients: number } {
    return {
      patients: clinic.patients.length,
      appointments: clinic.appointments.length,
      results: clinic.results.length,
      shownPatients: shownPatients.length,
    };
  },
};

window.__harness = harness;
window.__modelContext = model;
