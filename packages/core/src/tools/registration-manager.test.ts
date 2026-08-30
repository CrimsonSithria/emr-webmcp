/// <reference lib="dom" />

import { describe, expect, it } from 'vitest';

import { AdapterError } from '../contracts/adapter-error.js';
import type { EmrCapability } from '../contracts/capabilities.js';
import type { ToolResult, ToolResultDeps } from '../contracts/tool-result.js';
import type { ModelContext } from './model-context.js';
import { RegistrationManager, type ToolRuntime } from './registration-manager.js';
import { TOOL_DEFINITIONS, type ToolName } from './tool-definitions.js';

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

const ALL_NAMES: readonly ToolName[] = TOOL_DEFINITIONS.map((tool) => tool.name);

const DEPS: ToolResultDeps = {
  randomUUID: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  now: () => new Date('2026-08-31T04:00:00.000Z'),
  adapterId: 'lifecycle-test',
};

type RegisteredTool = {
  name: string;
  description: string;
  inputSchema: object;
  execute: (input: unknown, signal: AbortSignal) => Promise<unknown>;
};

class FakeModelContext implements ModelContext {
  readonly tools: RegisteredTool[] = [];
  readonly unregisterLog: string[] = [];
  readonly abortedWhenUnregistered: boolean[] = [];
  private readonly signalByName = new Map<string, AbortSignal>();

  rememberSignal(name: string, signal: AbortSignal): void {
    this.signalByName.set(name, signal);
  }

  registerTool(tool: RegisteredTool): { unregister: () => void } {
    this.tools.push(tool);
    return {
      unregister: () => {
        this.unregisterLog.push(tool.name);
        this.abortedWhenUnregistered.push(this.signalByName.get(tool.name)?.aborted ?? false);
        const index = this.tools.indexOf(tool);
        if (index >= 0) {
          this.tools.splice(index, 1);
        }
      },
    };
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

function createRuntime(
  overrides: Partial<Record<ToolName, ToolRuntime[ToolName]>> = {},
): {
  runtime: ToolRuntime;
  calls: Array<{ name: ToolName; input: unknown; signal: AbortSignal }>;
} {
  const calls: Array<{ name: ToolName; input: unknown; signal: AbortSignal }> = [];
  const runtime = Object.fromEntries(
    ALL_NAMES.map((toolName) => {
      const handler: ToolRuntime[ToolName] =
        overrides[toolName] ??
        ((input: unknown, signal: AbortSignal) => {
          calls.push({ name: toolName, input, signal });
          return Promise.resolve({ handled: toolName, input });
        });
      return [toolName, handler];
    }),
  ) as ToolRuntime;
  return { runtime, calls };
}

function context(
  modelContext: ModelContext,
  runtime: ToolRuntime,
  options?: {
    userId?: string;
    capabilities?: Iterable<EmrCapability>;
    privileges?: Iterable<string>;
    routeContext?: string;
  },
): RegistrationManager {
  const manager = new RegistrationManager({
    modelContext,
    runtime,
    deps: DEPS,
  });
  manager.update({
    userId: options?.userId ?? 'user-1',
    capabilities: new Set(options?.capabilities ?? ALL_CAPABILITIES),
    privileges: new Set(options?.privileges ?? ['session', 'emr-webmcp.use']),
    routeContext: options?.routeContext ?? '/home',
  });
  return manager;
}

async function invoke(
  tool: RegisteredTool,
  input: unknown,
  signal = new AbortController().signal,
): Promise<ToolResult<unknown>> {
  return (await tool.execute(input, signal)) as ToolResult<unknown>;
}

describe('RegistrationManager lifecycle', () => {
  it('registers the eligible set on the first update', () => {
    const model = new FakeModelContext();
    const { runtime } = createRuntime();
    context(model, runtime);

    expect(model.names()).toEqual(ALL_NAMES);
    expect(model.tools).toHaveLength(12);
    expect(model.tools.every((tool) => typeof tool.execute === 'function')).toBe(true);
  });

  it('omits tools whose required capability is missing', () => {
    const model = new FakeModelContext();
    const { runtime } = createRuntime();
    context(model, runtime, {
      capabilities: ['search-patients', 'navigate-tests'],
    });

    expect(model.names()).toEqual(['get_active_patient', 'search_patients']);
  });

  it('omits tools whose required privilege is missing', () => {
    const model = new FakeModelContext();
    const { runtime } = createRuntime();
    context(model, runtime, { privileges: ['session'] });

    expect(model.names()).toEqual(['get_active_patient']);
  });

  it('replaces registrations when the context fingerprint changes', async () => {
    const model = new FakeModelContext();
    const { runtime, calls } = createRuntime();
    const manager = context(model, runtime);
    const firstGeneration = [...model.tools];

    await invoke(model.tool('search_patients'), { query: 'Ada', limit: 5 });
    const previousSignal = calls[0]?.signal;
    expect(previousSignal?.aborted).toBe(false);

    model.rememberSignal('search_patients', previousSignal as AbortSignal);
    manager.update({
      userId: 'user-2',
      capabilities: new Set(ALL_CAPABILITIES),
      privileges: new Set(['session', 'emr-webmcp.use']),
      routeContext: '/home',
    });

    expect(previousSignal?.aborted).toBe(true);
    expect(model.unregisterLog).toHaveLength(12);
    expect(model.abortedWhenUnregistered[model.unregisterLog.indexOf('search_patients')]).toBe(true);
    expect(model.names()).toEqual(ALL_NAMES);
    expect(model.tools.some((tool) => firstGeneration.includes(tool))).toBe(false);
  });

  it('does not replace registrations when sorted fingerprint fields are unchanged', () => {
    const model = new FakeModelContext();
    const { runtime } = createRuntime();
    const manager = context(model, runtime, {
      capabilities: ['get-chart-brief', 'search-patients'],
      privileges: ['emr-webmcp.use', 'session'],
    });
    const firstGeneration = [...model.tools];

    manager.update({
      userId: 'user-1',
      capabilities: new Set(['search-patients', 'get-chart-brief']),
      privileges: new Set(['session', 'emr-webmcp.use']),
      routeContext: '/home',
    });

    expect(model.unregisterLog).toEqual([]);
    expect(model.tools).toEqual(firstGeneration);
  });

  it('rechecks authorization at execution time against live policy inputs', async () => {
    const model = new FakeModelContext();
    const { runtime, calls } = createRuntime();
    const privileges = new Set(['session', 'emr-webmcp.use']);
    const manager = new RegistrationManager({ modelContext: model, runtime, deps: DEPS });
    manager.update({
      userId: 'user-1',
      capabilities: new Set(ALL_CAPABILITIES),
      privileges,
      routeContext: '/home',
    });

    privileges.delete('emr-webmcp.use');
    const result = await invoke(model.tool('search_patients'), { query: 'Ada', limit: 5 });

    expect(result.ok).toBe(false);
    expect(result.error).toEqual({
      code: 'unauthorized',
      message: 'Not authorized to invoke this tool.',
      retryable: false,
    });
    expect(calls).toEqual([]);
  });

  it.each(['logout', 'userChange', 'unmount'] as const)(
    '%s aborts every child signal and unregisters all tools',
    async (method) => {
      const model = new FakeModelContext();
      const { runtime, calls } = createRuntime();
      const manager = context(model, runtime);
      await invoke(model.tool('get_active_patient'), {});
      const child = calls[0]?.signal;
      expect(child?.aborted).toBe(false);
      if (child !== undefined) {
        model.rememberSignal('get_active_patient', child);
      }

      const stale = model.tool('get_active_patient');
      manager[method]();

      expect(child?.aborted).toBe(true);
      expect(model.names()).toEqual([]);
      expect(model.unregisterLog).toHaveLength(12);
      expect(model.abortedWhenUnregistered[model.unregisterLog.indexOf('get_active_patient')]).toBe(
        true,
      );

      const result = await invoke(stale, {});
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('unauthorized');
    },
  );
});

describe('RegistrationManager execution', () => {
  it('returns unauthorized when the host signal is already aborted', async () => {
    const model = new FakeModelContext();
    const { runtime, calls } = createRuntime();
    context(model, runtime);
    const controller = new AbortController();
    controller.abort();

    const result = await invoke(model.tool('get_active_patient'), {}, controller.signal);

    expect(result.error?.code).toBe('unauthorized');
    expect(calls).toEqual([]);
  });

  it('validates input against the schema before calling the handler', async () => {
    const model = new FakeModelContext();
    const { runtime, calls } = createRuntime();
    context(model, runtime);

    const result = await invoke(model.tool('search_patients'), {
      query: 'Ada',
      limit: 21,
      extra: true,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toEqual({
      code: 'invalid-input',
      message: 'Input did not match the tool schema.',
      retryable: false,
    });
    expect(calls).toEqual([]);
  });

  it('wraps handler data with successResult using injected deps', async () => {
    const model = new FakeModelContext();
    const { runtime } = createRuntime({
      get_active_patient: () => Promise.resolve({ id: 'patient-ada', display: 'Ada Lovelace' }),
    });
    context(model, runtime);

    const result = await invoke(model.tool('get_active_patient'), {});

    expect(result).toEqual({
      ok: true,
      data: { id: 'patient-ada', display: 'Ada Lovelace' },
      meta: {
        invocationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        adapterId: 'lifecycle-test',
        generatedAt: '2026-08-31T04:00:00.000Z',
        truncated: false,
      },
    });
  });

  it('maps AdapterError onto errorResult with the original code', async () => {
    const model = new FakeModelContext();
    const { runtime } = createRuntime({
      get_result_context: () =>
        Promise.reject(new AdapterError('not-found', 'The requested result was not found.', false)),
    });
    context(model, runtime);

    const result = await invoke(model.tool('get_result_context'), { resultId: 'result-1' });

    expect(result.ok).toBe(false);
    expect(result.error).toEqual({
      code: 'not-found',
      message: 'The requested result was not found.',
      retryable: false,
    });
  });

  it('sanitizes unexpected failures to a public upstream error', async () => {
    const model = new FakeModelContext();
    const { runtime } = createRuntime({
      get_chart_brief: () => {
        const error = new Error('ECONNRESET postgres://secret:password@db/patients');
        error.stack = 'Error: leaked stack\n    at Adapter.fetch';
        return Promise.reject(Object.assign(error, { body: { raw: { fhir: true } } }));
      },
    });
    context(model, runtime);

    const result = await invoke(model.tool('get_chart_brief'), { patientId: 'patient-ada' });
    const serialized = JSON.stringify(result);

    expect(result.ok).toBe(false);
    expect(result.error).toEqual({
      code: 'upstream',
      message: 'Upstream request failed',
      retryable: true,
    });
    expect(serialized).not.toContain('postgres');
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('leaked stack');
    expect(serialized).not.toContain('fhir');
    expect(serialized).not.toContain('ECONNRESET');
  });

  it('passes the child abort signal through to the injected handler', async () => {
    const model = new FakeModelContext();
    const { runtime, calls } = createRuntime();
    const manager = context(model, runtime);

    await invoke(model.tool('open_review_queue'), {});
    const child = calls[0]?.signal;
    expect(child).toBeInstanceOf(AbortSignal);
    expect(child?.aborted).toBe(false);

    manager.logout();
    expect(child?.aborted).toBe(true);
  });

  it('returns unauthorized when authorization is revoked while a handler is failing', async () => {
    const model = new FakeModelContext();
    const privileges = new Set(['session', 'emr-webmcp.use']);
    let started!: () => void;
    const startedGate = new Promise<void>((resolve) => {
      started = resolve;
    });
    let fail!: (reason: unknown) => void;
    const deferred = new Promise<never>((_resolve, reject) => {
      fail = reject;
    });
    const { runtime } = createRuntime({
      get_chart_brief: () => {
        started();
        return deferred;
      },
    });
    const manager = new RegistrationManager({ modelContext: model, runtime, deps: DEPS });
    manager.update({
      userId: 'user-1',
      capabilities: new Set(ALL_CAPABILITIES),
      privileges,
      routeContext: '/home',
    });

    const pending = invoke(model.tool('get_chart_brief'), { patientId: 'patient-ada' });
    await startedGate;
    privileges.delete('emr-webmcp.use');
    fail(new AdapterError('not-found', 'The requested result was not found.', false));

    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.error).toEqual({
      code: 'unauthorized',
      message: 'Not authorized to invoke this tool.',
      retryable: false,
    });
  });

  it('forwards a host abort to the in-flight handler and returns unauthorized', async () => {
    const model = new FakeModelContext();
    let started!: () => void;
    const startedGate = new Promise<void>((resolve) => {
      started = resolve;
    });
    let handlerSignal: AbortSignal | undefined;
    const { runtime } = createRuntime({
      get_active_patient: (_input, signal) =>
        new Promise((_resolve, reject) => {
          handlerSignal = signal;
          started();
          signal.addEventListener(
            'abort',
            () => {
              reject(new Error('handler observed abort'));
            },
            { once: true },
          );
        }),
    });
    context(model, runtime);
    const host = new AbortController();

    const pending = invoke(model.tool('get_active_patient'), {}, host.signal);
    await startedGate;
    expect(handlerSignal?.aborted).toBe(false);
    host.abort();

    const result = await pending;
    expect(handlerSignal?.aborted).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.error).toEqual({
      code: 'unauthorized',
      message: 'Not authorized to invoke this tool.',
      retryable: false,
    });
  });
});

describe('RegistrationManager wiring', () => {
  it('never registers createFollowup or a write tool', () => {
    const model = new FakeModelContext();
    const { runtime } = createRuntime();
    context(model, runtime);

    expect(model.names()).not.toContain('createFollowup');
    expect(model.names()).not.toContain('create_followup');
  });
});
