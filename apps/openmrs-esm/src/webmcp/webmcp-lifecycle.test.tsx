import {
  TOOL_NAMES,
  type FollowupDraft,
  type ModelContext,
  type ModelContextTool,
  type ToolResult,
} from '@emr-webmcp/core';
import { getSessionStore, openmrsFetch } from '@openmrs/esm-framework';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import EmrWebmcp from '../emr-webmcp.component';
import { readAgentActivity, readConfirmedFollowup } from './agent-activity';
import { startWebmcpLifecycle, stopWebmcpLifecycle } from './webmcp-lifecycle';

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

function authenticate(userId = 'user-1'): void {
  getSessionStore().setState({
    loaded: true,
    session: {
      authenticated: true,
      sessionId: 'session-1',
      user: { uuid: userId },
    },
  } as never);
}

function logout(): void {
  getSessionStore().setState({
    loaded: true,
    session: { authenticated: false },
  } as never);
}

function mockProbe(status: number): void {
  vi.mocked(openmrsFetch).mockResolvedValue({ status, data: { secret: 'secret-token-xyz' } } as never);
}

async function invoke(tool: RegisteredTool, input: unknown): Promise<ToolResult<unknown>> {
  return (await tool.execute(input, new AbortController().signal)) as ToolResult<unknown>;
}

function carePlanProbePaths(): string[] {
  return vi
    .mocked(openmrsFetch)
    .mock.calls.map(([path]) => String(path))
    .filter((path) => path.includes('/ws/rest/v1/tasks/careplan'));
}

afterEach(() => {
  stopWebmcpLifecycle();
  clearModelContext();
  vi.mocked(openmrsFetch).mockReset();
  vi.mocked(openmrsFetch).mockImplementation(() => new Promise(() => {}));
  getSessionStore().setState({ loaded: false, session: null });
});

describe('WebMCP module lifecycle', () => {
  it('does not crash when document.modelContext is absent', () => {
    mockProbe(200);
    authenticate();
    expect(() => startWebmcpLifecycle()).not.toThrow();
  });

  it('registers twelve eligible tools when the session and probe are complete', async () => {
    const model = installFakeModelContext();
    mockProbe(200);
    authenticate();

    startWebmcpLifecycle();

    await waitFor(() => {
      expect(model.names()).toEqual([...TOOL_NAMES]);
    });
    expect(model.tools.every((tool) => typeof tool.execute === 'function')).toBe(true);
  });

  it('does not register follow-up tools when the Tasks probe returns 404', async () => {
    const model = installFakeModelContext();
    mockProbe(404);
    authenticate();

    startWebmcpLifecycle();

    await waitFor(() => {
      expect(model.names()).not.toContain('list_open_followups');
      expect(model.names()).not.toContain('stage_followup_task');
      expect(model.names()).toContain('search_patients');
    });
    expect(carePlanProbePaths().every((path) => new URL(path, 'http://openmrs.local').searchParams.has('subject'))).toBe(
      true,
    );
  });

  it('aborts prior registrations on logout', async () => {
    const model = installFakeModelContext();
    mockProbe(200);
    authenticate();
    startWebmcpLifecycle();
    await waitFor(() => {
      expect(model.names()).toHaveLength(12);
    });
    const unregisteredAfterReady = model.unregisterLog.length;

    logout();

    await waitFor(() => {
      expect(model.names()).toEqual([]);
      expect(model.unregisterLog).toHaveLength(unregisteredAfterReady + 12);
    });
  });

  it('aborts prior registrations on user change', async () => {
    const model = installFakeModelContext();
    mockProbe(200);
    authenticate('user-1');
    startWebmcpLifecycle();
    await waitFor(() => {
      expect(model.names()).toHaveLength(12);
    });
    const firstGeneration = [...model.tools];
    const unregisteredAfterReady = model.unregisterLog.length;

    const staged = await invoke(model.tool('stage_followup_task'), {
      patient: { id: 'patient-1', display: 'Ada Lovelace' },
      title: 'Follow up potassium',
      rationale: 'Repeat the BMP in clinic.',
      priority: 'high',
    });
    expect(staged.ok).toBe(true);
    expect(readAgentActivity()?.tool).toBe('stage_followup_task');

    authenticate('user-2');

    await waitFor(() => {
      expect(model.unregisterLog).toHaveLength(unregisteredAfterReady + 12);
      expect(model.names()).toEqual([...TOOL_NAMES]);
      expect(model.tools.some((tool) => firstGeneration.includes(tool))).toBe(false);
      expect(readAgentActivity()).toBeNull();
      expect(readConfirmedFollowup()).toBeNull();
    });
  });

  it('replaces registrations when privileges change with the session', async () => {
    const model = installFakeModelContext();
    mockProbe(200);
    authenticate();
    startWebmcpLifecycle();
    await waitFor(() => {
      expect(model.names()).toEqual([...TOOL_NAMES]);
    });

    logout();

    await waitFor(() => {
      expect(model.names()).toEqual([]);
    });
  });

  it('keeps tools registered after leaving /emr-webmcp and replaces the route-context generation', async () => {
    const model = installFakeModelContext();
    mockProbe(200);
    authenticate();
    window.history.pushState({}, '', '/openmrs/spa/emr-webmcp');

    startWebmcpLifecycle();
    const view = render(<EmrWebmcp />);
    expect(screen.getByTestId('emr-webmcp-shell')).toBeInTheDocument();

    await waitFor(() => {
      expect(model.names()).toEqual([...TOOL_NAMES]);
    });
    const firstGeneration = [...model.tools];
    const unregisteredBeforeNavigation = model.unregisterLog.length;

    view.unmount();
    expect(screen.queryByTestId('emr-webmcp-shell')).not.toBeInTheDocument();
    expect(model.names()).toEqual([...TOOL_NAMES]);
    expect(model.tools).toEqual(firstGeneration);

    window.history.pushState({}, '', '/openmrs/spa/patient/patient-ada/chart/Results');
    window.dispatchEvent(new Event('single-spa:routing-event'));

    await waitFor(() => {
      expect(model.unregisterLog).toHaveLength(unregisteredBeforeNavigation + 12);
      expect(model.names()).toEqual([...TOOL_NAMES]);
      expect(model.tools.some((tool) => firstGeneration.includes(tool))).toBe(false);
    });
  });

  it('aborts prior registrations on lifecycle teardown', async () => {
    const model = installFakeModelContext();
    mockProbe(200);
    authenticate();
    startWebmcpLifecycle();
    await waitFor(() => {
      expect(model.names()).toHaveLength(12);
    });
    const unregisteredAfterReady = model.unregisterLog.length;

    stopWebmcpLifecycle();

    expect(model.names()).toEqual([]);
    expect(model.unregisterLog).toHaveLength(unregisteredAfterReady + 12);
  });

  it('shows staged agent activity and the draft on the LabLatch page', async () => {
    const model = installFakeModelContext();
    mockProbe(200);
    authenticate();
    startWebmcpLifecycle();
    await waitFor(() => {
      expect(model.names()).toEqual([...TOOL_NAMES]);
    });

    const staged = await invoke(model.tool('stage_followup_task'), {
      draftId: 'draft-1',
      patient: { id: 'patient-1', display: 'Ada Lovelace' },
      title: 'Follow up potassium',
      rationale: 'Repeat the BMP in clinic.',
      priority: 'high',
    });
    expect(staged.ok).toBe(true);

    render(<EmrWebmcp />);
    expect(screen.getByTestId('agent-activity-tool')).toHaveTextContent('Stage follow-up draft');
    expect(screen.getByTestId('agent-activity-lines')).toHaveTextContent('Confirm follow-up is the only chart write');
    expect(screen.getByTestId('review-item-title')).toHaveTextContent('Follow up potassium');
  });

  it('rechecks session inside handlers and never POSTs a CarePlan from stage_followup_task', async () => {
    const model = installFakeModelContext();
    mockProbe(200);
    authenticate();
    startWebmcpLifecycle();
    await waitFor(() => {
      expect(model.names()).toEqual([...TOOL_NAMES]);
    });

    const draft: FollowupDraft = {
      draftId: 'draft-1',
      patient: { id: 'patient-1', display: 'Ada Lovelace' },
      title: 'Follow up potassium',
      rationale: 'Repeat the BMP in clinic.',
      priority: 'high',
    };
    const searchTool = model.tool('search_patients');
    const staged = await invoke(model.tool('stage_followup_task'), draft);
    expect(staged.ok).toBe(true);
    expect(
      vi
        .mocked(openmrsFetch)
        .mock.calls.some(([, init]) => (init as { method?: string } | undefined)?.method === 'POST'),
    ).toBe(false);

    logout();
    const denied = await invoke(searchTool, { query: 'Ada', limit: 5 });
    expect(denied.ok).toBe(false);
    expect(denied.error?.code).toBe('unauthorized');
  });
});
