import {
  TOOL_NAMES,
  type EmrAdapter,
  type EmrCapability,
  type FollowupDraft,
  type ModelContext,
  type ModelContextTool,
  type ToolResult,
} from '@emr-webmcp/core';
import { usePatient, useSession } from '@openmrs/esm-framework';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import EmrWebmcp from '../emr-webmcp.component';
import { useWebmcpRegistration, type SessionSnapshot } from './use-webmcp-registration';

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

function Harness(props: {
  session: SessionSnapshot;
  privileges: ReadonlySet<string>;
  capabilities: ReadonlySet<EmrCapability>;
  routeContext: string;
  adapter: EmrAdapter;
}) {
  useWebmcpRegistration(props);
  return <div data-testid="webmcp-harness" />;
}

function renderHarness(
  model: FakeModelContext,
  options?: {
    session?: SessionSnapshot;
    privileges?: ReadonlySet<string>;
    capabilities?: Iterable<EmrCapability>;
    routeContext?: string;
    adapter?: EmrAdapter;
  },
) {
  const props = {
    session: options?.session ?? { authenticated: true, userId: 'user-1' },
    privileges: options?.privileges ?? BOTH_PRIVILEGES,
    capabilities: new Set(options?.capabilities ?? ALL_CAPABILITIES),
    routeContext: options?.routeContext ?? '/home',
    adapter: options?.adapter ?? stubAdapter(),
  };
  const view = render(<Harness {...props} />);
  expect(model).toBeDefined();
  return {
    ...view,
    props,
    rerenderWith(next: Partial<typeof props>) {
      view.rerender(<Harness {...props} {...next} />);
    },
  };
}

async function invoke(tool: RegisteredTool, input: unknown): Promise<ToolResult<unknown>> {
  return (await tool.execute(input, new AbortController().signal)) as ToolResult<unknown>;
}

afterEach(() => {
  clearModelContext();
});

describe('useWebmcpRegistration', () => {
  it('does not crash when document.modelContext is absent', () => {
    expect(() =>
      render(
        <Harness
          session={{ authenticated: true, userId: 'user-1' }}
          privileges={BOTH_PRIVILEGES}
          capabilities={new Set(ALL_CAPABILITIES)}
          routeContext="/home"
          adapter={stubAdapter()}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByTestId('webmcp-harness')).toBeInTheDocument();
  });

  it('registers twelve eligible tools when privileges and capabilities are complete', () => {
    const model = installFakeModelContext();
    renderHarness(model);

    expect(model.names()).toEqual([...TOOL_NAMES]);
    expect(model.tools).toHaveLength(12);
    expect(model.tools.every((tool) => typeof tool.execute === 'function')).toBe(true);
  });

  it('omits unsupported tools when a required capability is missing', () => {
    const model = installFakeModelContext();
    renderHarness(model, { capabilities: ['search-patients'] });

    expect(model.names()).toEqual(['get_active_patient', 'search_patients']);
  });

  it('aborts prior registrations on logout', () => {
    const model = installFakeModelContext();
    const view = renderHarness(model);
    expect(model.names()).toHaveLength(12);

    view.rerenderWith({
      session: { authenticated: false, userId: null },
      privileges: EMPTY,
    });

    expect(model.names()).toEqual([]);
    expect(model.unregisterLog).toHaveLength(12);
  });

  it('aborts prior registrations on user change', () => {
    const model = installFakeModelContext();
    const view = renderHarness(model);
    const firstGeneration = [...model.tools];

    view.rerenderWith({ session: { authenticated: true, userId: 'user-2' } });

    expect(model.unregisterLog).toHaveLength(12);
    expect(model.names()).toEqual([...TOOL_NAMES]);
    expect(model.tools.some((tool) => firstGeneration.includes(tool))).toBe(false);
  });

  it('replaces registrations when privileges change', () => {
    const model = installFakeModelContext();
    const view = renderHarness(model);

    view.rerenderWith({ privileges: SESSION_ONLY });

    expect(model.names()).toEqual(['get_active_patient']);
    expect(model.unregisterLog).toHaveLength(12);
  });

  it('replaces registrations when route context changes', () => {
    const model = installFakeModelContext();
    const view = renderHarness(model);
    const firstGeneration = [...model.tools];

    view.rerenderWith({ routeContext: '/patient/patient-ada' });

    expect(model.unregisterLog).toHaveLength(12);
    expect(model.names()).toEqual([...TOOL_NAMES]);
    expect(model.tools.some((tool) => firstGeneration.includes(tool))).toBe(false);
  });

  it('aborts prior registrations on unmount', () => {
    const model = installFakeModelContext();
    const view = renderHarness(model);

    view.unmount();

    expect(model.names()).toEqual([]);
    expect(model.unregisterLog).toHaveLength(12);
  });

  it('rechecks session inside handlers and never calls createFollowup from stage_followup_task', async () => {
    const model = installFakeModelContext();
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
    const adapter = stubAdapter({ createFollowup, searchPatients });
    const view = renderHarness(model, { adapter });

    const draft: FollowupDraft = {
      draftId: 'draft-1',
      patient: { id: 'patient-1', display: 'Ada Lovelace' },
      title: 'Follow up potassium',
      rationale: 'Repeat the BMP in clinic.',
      priority: 'high',
    };
    const staged = await invoke(model.tool('stage_followup_task'), draft);
    expect(staged.ok).toBe(true);
    expect(createFollowup).not.toHaveBeenCalled();

    const searchTool = model.tool('search_patients');
    view.rerenderWith({
      session: { authenticated: false, userId: null },
      privileges: EMPTY,
    });

    const denied = await invoke(searchTool, { query: 'Ada', limit: 5 });
    expect(denied.ok).toBe(false);
    expect(denied.error?.code).toBe('unauthorized');
    expect(searchPatients).not.toHaveBeenCalled();
  });
});

describe('EmrWebmcp page', () => {
  it('shows a non-blocking compatibility notice when WebMCP is absent and keeps the module usable', () => {
    vi.mocked(useSession).mockReturnValue({
      authenticated: true,
      sessionId: 'session-1',
      user: { uuid: 'user-1' },
    } as ReturnType<typeof useSession>);
    vi.mocked(usePatient).mockReturnValue({
      isLoading: false,
      patient: null,
      patientUuid: 'patient-1',
      error: null,
    });

    expect(() => render(<EmrWebmcp />)).not.toThrow();
    expect(screen.getByTestId('emr-webmcp-shell')).toBeInTheDocument();
    expect(screen.getByTestId('webmcp-compat-notice')).toBeInTheDocument();
    expect(screen.queryByText(/patient-1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/emr-webmcp\.use/)).not.toBeInTheDocument();
    expect(screen.queryByText(/user-1/)).not.toBeInTheDocument();
  });
});
