import {
  DraftStore,
  RegistrationManager,
  TOOL_NAMES,
  type EmrAdapter,
  type EmrCapability,
  type FollowupDraft,
  type ModelContext,
  type ModelContextTool,
  type ToolResult,
} from '@emr-webmcp/core';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import EmrWebmcp from '../emr-webmcp.component';
import { createSessionCheckedRuntime, type SessionSnapshot } from './use-webmcp-registration';

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

const BOTH_PRIVILEGES = new Set(['session', 'emr-webmcp.use']);
const SESSION_ONLY = new Set(['session']);
const EMPTY = new Set<string>();

type RegisteredTool = ModelContextTool & { unregister: () => void };

class FakeModelContext implements ModelContext {
  readonly tools: RegisteredTool[] = [];
  readonly unregisterLog: string[] = [];

  registerTool(tool: ModelContextTool): { unregister: () => void } {
    const registered: RegisteredTool = {
      ...tool,
      unregister: () => {
        this.unregisterLog.push(tool.name);
        const index = this.tools.indexOf(registered);
        if (index >= 0) {
          this.tools.splice(index, 1);
        }
      },
    };
    this.tools.push(registered);
    return { unregister: registered.unregister };
  }

  names(): string[] {
    return this.tools.map((tool) => tool.name);
  }

  tool(name: string): RegisteredTool {
    const found = this.tools.find((tool) => tool.name === name);
    if (found === undefined) {
      throw new Error(`tool ${name} is not registered`);
    }
    return found;
  }
}

function installFakeModelContext(): FakeModelContext {
  const fake = new FakeModelContext();
  Object.defineProperty(document, 'modelContext', {
    configurable: true,
    writable: true,
    value: fake,
  });
  return fake;
}

function clearModelContext(): void {
  delete (document as Document & { modelContext?: unknown }).modelContext;
}

function stubAdapter(overrides: Partial<EmrAdapter> = {}): EmrAdapter {
  return {
    id: 'openmrs',
    getCapabilities: () => Promise.resolve(new Set(ALL_CAPABILITIES)),
    getActivePatient: () => Promise.resolve(null),
    searchPatients: () => Promise.resolve([]),
    listAppointments: () => Promise.resolve([]),
    getChartBrief: () =>
      Promise.resolve({
        patient: { id: 'patient-1', display: 'Ada Lovelace' },
        conditions: [],
        allergies: [],
        medications: [],
        recentVitals: [],
        recentResults: [],
        openTasks: [],
      }),
    listAbnormalResults: () => Promise.resolve([]),
    getResult: () =>
      Promise.resolve({
        id: 'obs-1',
        patient: { id: 'patient-1', display: 'Ada Lovelace' },
        name: 'Potassium',
        observedAt: '2026-08-31T04:00:00.000Z',
        interpretation: 'high',
        sourceReference: 'Observation/obs-1',
      }),
    listFollowups: () => Promise.resolve([]),
    listAssignees: () => Promise.resolve([]),
    createFollowup: () =>
      Promise.resolve({
        id: 'task-written',
        patient: { id: 'patient-1', display: 'Ada Lovelace' },
        title: 'should not be written',
        status: 'not-started',
        priority: 'high',
      }),
    navigate: () => Promise.resolve(),
    ...overrides,
  };
}

function startManager(options?: {
  session?: SessionSnapshot;
  privileges?: ReadonlySet<string>;
  adapter?: EmrAdapter;
}): {
  model: FakeModelContext;
  session: SessionSnapshot;
  privileges: ReadonlySet<string>;
  drafts: DraftStore;
  manager: RegistrationManager;
  apply: (next?: { session?: SessionSnapshot; privileges?: ReadonlySet<string> }) => void;
} {
  const model = installFakeModelContext();
  const state = {
    session: options?.session ?? { authenticated: true, userId: 'user-1' },
    privileges: options?.privileges ?? BOTH_PRIVILEGES,
  };
  const drafts = new DraftStore({
    userId: state.session.userId ?? 'user-1',
    now: () => new Date(),
    randomUUID: () => 'store-draft-1',
  });
  const adapter = options?.adapter ?? stubAdapter();
  const runtime = createSessionCheckedRuntime({
    getAdapter: () => adapter,
    getSession: () => state.session,
    getPrivileges: () => state.privileges,
    getDraftStore: () => drafts,
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
  const apply = (next?: { session?: SessionSnapshot; privileges?: ReadonlySet<string> }): void => {
    if (next?.session !== undefined) {
      state.session = next.session;
    }
    if (next?.privileges !== undefined) {
      state.privileges = next.privileges;
    }
    if (!state.session.authenticated || state.session.userId === null) {
      manager.logout();
      drafts.logout();
      return;
    }
    manager.update({
      userId: state.session.userId,
      privileges: state.privileges,
      capabilities: new Set(ALL_CAPABILITIES),
      routeContext: '/home',
    });
  };
  apply();
  return { model, session: state.session, privileges: state.privileges, drafts, manager, apply };
}

async function invoke(tool: RegisteredTool, input: unknown): Promise<ToolResult<unknown>> {
  return (await tool.execute(input, new AbortController().signal)) as ToolResult<unknown>;
}

afterEach(() => {
  clearModelContext();
});

describe('createSessionCheckedRuntime', () => {
  it('replaces registrations when privileges change', () => {
    const { model, apply } = startManager();
    expect(model.names()).toEqual([...TOOL_NAMES]);

    apply({ privileges: SESSION_ONLY });

    expect(model.names()).toEqual(['get_active_patient']);
    expect(model.unregisterLog).toHaveLength(12);
  });

  it('rechecks session inside handlers and never calls createFollowup from stage_followup_task', async () => {
    const createFollowup = vi.fn(() =>
      Promise.resolve({
        id: 'task-written',
        patient: { id: 'patient-1', display: 'Ada Lovelace' },
        title: 'should not be written',
        status: 'not-started' as const,
        priority: 'high' as const,
      }),
    );
    const searchPatients = vi.fn(() => Promise.resolve([]));
    const { model, apply, drafts } = startManager({
      adapter: stubAdapter({ createFollowup, searchPatients }),
    });

    const draft: FollowupDraft = {
      draftId: 'draft-1',
      patient: { id: 'patient-1', display: 'Ada Lovelace' },
      title: 'Follow up potassium',
      rationale: 'Repeat the BMP in clinic.',
      priority: 'high',
    };
    const staged = await invoke(model.tool('stage_followup_task'), draft);
    expect(staged.ok).toBe(true);
    expect(staged.data).toEqual({ draftId: 'store-draft-1' });
    expect(drafts.peek('store-draft-1').title).toBe('Follow up potassium');
    expect(createFollowup).not.toHaveBeenCalled();

    const searchTool = model.tool('search_patients');
    apply({
      session: { authenticated: false, userId: null },
      privileges: EMPTY,
    });

    const denied = await invoke(searchTool, { query: 'Ada', limit: 5 });
    expect(denied.ok).toBe(false);
    expect(denied.error?.code).toBe('unauthorized');
    expect(searchPatients).not.toHaveBeenCalled();
  });

  it('runs LabLatch instead of returning raw abnormal results', async () => {
    const result = {
      id: 'obs-1',
      patient: { id: 'patient-1', display: 'Ada Lovelace' },
      name: 'Potassium',
      observedAt: '2026-08-31T04:00:00.000Z',
      interpretation: 'high' as const,
      sourceReference: 'Observation/obs-1',
    };
    const listAbnormalResults = vi.fn(() => Promise.resolve([result]));
    const listFollowups = vi.fn(() =>
      Promise.resolve([
        {
          id: 'task-1',
          patient: result.patient,
          title: 'Repeat potassium',
          status: 'in-progress' as const,
          priority: 'high' as const,
          sourceReference: result.sourceReference,
        },
      ]),
    );
    const { model } = startManager({
      adapter: stubAdapter({ listAbnormalResults, listFollowups }),
    });

    const found = await invoke(model.tool('find_unlatched_abnormal_results'), { limit: 100 });
    expect(found.ok).toBe(true);
    expect(found.data).toEqual([]);
    expect(listAbnormalResults).toHaveBeenCalled();
    expect(listFollowups).toHaveBeenCalled();
  });

  it('returns only open follow-ups from list_open_followups', async () => {
    const listFollowups = vi.fn(() =>
      Promise.resolve([
        {
          id: 'open-1',
          patient: { id: 'patient-1', display: 'Ada Lovelace' },
          title: 'Open',
          status: 'not-started' as const,
          priority: 'high' as const,
        },
        {
          id: 'done-1',
          patient: { id: 'patient-1', display: 'Ada Lovelace' },
          title: 'Done',
          status: 'completed' as const,
          priority: 'low' as const,
        },
      ]),
    );
    const { model } = startManager({
      adapter: stubAdapter({ listFollowups }),
    });

    const listed = await invoke(model.tool('list_open_followups'), {
      limit: 20,
      patientId: 'patient-1',
    });
    expect(listed.ok).toBe(true);
    expect(listed.data).toEqual([
      expect.objectContaining({ id: 'open-1', status: 'not-started' }),
    ]);
    expect(listFollowups).toHaveBeenCalledWith({ limit: 20, patientId: 'patient-1' });
  });
});

describe('EmrWebmcp page', () => {
  it('shows a non-blocking compatibility notice when WebMCP is absent and keeps the module usable', () => {
    expect(() => render(<EmrWebmcp />)).not.toThrow();
    expect(screen.getByTestId('emr-webmcp-shell')).toBeInTheDocument();
    expect(screen.getByTestId('webmcp-compat-notice')).toBeInTheDocument();
    expect(screen.queryByText(/patient-1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/emr-webmcp\.use/)).not.toBeInTheDocument();
    expect(screen.queryByText(/user-1/)).not.toBeInTheDocument();
  });
});
