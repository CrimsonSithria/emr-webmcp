import { TOOL_NAMES, type ModelContext, type ModelContextTool } from '@emr-webmcp/core';
import { getSessionStore, openmrsFetch } from '@openmrs/esm-framework';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import EmrWebmcp from '../emr-webmcp.component';
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

function authenticate(): void {
  getSessionStore().setState({
    loaded: true,
    session: {
      authenticated: true,
      sessionId: 'session-1',
      user: { uuid: 'user-1' },
    },
  } as never);
}

afterEach(() => {
  stopWebmcpLifecycle();
  clearModelContext();
  vi.mocked(openmrsFetch).mockReset();
  vi.mocked(openmrsFetch).mockImplementation(() => new Promise(() => {}));
  getSessionStore().setState({ loaded: false, session: null });
});

describe('WebMCP module lifecycle', () => {
  it('keeps tools registered after leaving /emr-webmcp and replaces the route-context generation', async () => {
    const model = installFakeModelContext();
    vi.mocked(openmrsFetch).mockResolvedValue({ status: 200, data: {} } as never);
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
});
