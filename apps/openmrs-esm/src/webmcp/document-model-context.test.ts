import type { ModelContextTool } from '@emr-webmcp/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createDocumentModelContext,
  getHostModelContext,
  hasDocumentModelContext,
  hostExecuteSignal,
  type HostModelContext,
} from './document-model-context';

const TOOL: ModelContextTool = {
  name: 'search_patients',
  description: 'Search',
  inputSchema: { type: 'object' },
  execute: async () => ({ ok: true }),
};

describe('hostExecuteSignal', () => {
  it('accepts an AbortSignal or the official { signal } options object', () => {
    const signal = new AbortController().signal;
    expect(hostExecuteSignal(signal)).toBe(signal);
    expect(hostExecuteSignal({ signal })).toBe(signal);
    expect(hostExecuteSignal({ signal: { aborted: false } })).toBeUndefined();
    expect(hostExecuteSignal(undefined)).toBeUndefined();
  });
});

describe('getHostModelContext', () => {
  const fakeHost = (): HostModelContext => ({ registerTool: () => undefined });

  afterEach(() => {
    delete (document as { modelContext?: unknown }).modelContext;
    delete (navigator as { modelContext?: unknown }).modelContext;
  });

  it('returns null when no host exposes the API', () => {
    expect(getHostModelContext()).toBeNull();
    expect(hasDocumentModelContext()).toBe(false);
  });

  it('prefers document.modelContext (Chrome 152+)', () => {
    const onDocument = fakeHost();
    const onNavigator = fakeHost();
    Object.defineProperty(document, 'modelContext', { value: onDocument, configurable: true });
    Object.defineProperty(navigator, 'modelContext', { value: onNavigator, configurable: true });
    expect(getHostModelContext()).toBe(onDocument);
  });

  it('falls back to navigator.modelContext (Chrome 146-151)', () => {
    const onNavigator = fakeHost();
    Object.defineProperty(navigator, 'modelContext', { value: onNavigator, configurable: true });
    expect(getHostModelContext()).toBe(onNavigator);
    expect(hasDocumentModelContext()).toBe(true);
  });

  it('ignores hosts without a callable registerTool', () => {
    Object.defineProperty(document, 'modelContext', { value: { registerTool: 'nope' }, configurable: true });
    expect(getHostModelContext()).toBeNull();
  });
});

describe('createDocumentModelContext', () => {
  it('forwards Chrome execute(input, { signal }) as an AbortSignal', async () => {
    const inner = vi.fn(async (_input: unknown, signal: AbortSignal) => {
      expect(signal).toBeInstanceOf(AbortSignal);
      return { ok: true };
    });
    let hostExecute: ((input: unknown, second?: unknown) => Promise<unknown>) | undefined;

    const host: HostModelContext = {
      registerTool(tool) {
        hostExecute = tool.execute;
        return { unregister: () => undefined };
      },
    };

    createDocumentModelContext(host).registerTool({ ...TOOL, execute: inner });
    const signal = new AbortController().signal;
    await hostExecute!({ query: 'Ada' }, { signal });
    expect(inner).toHaveBeenCalledWith({ query: 'Ada' }, signal);
  });

  it('swallows a rejected registerTool promise and still unregisters via the registration signal', async () => {
    const controllerRef: { signal?: AbortSignal } = {};
    const host: HostModelContext = {
      registerTool(_tool, options) {
        controllerRef.signal = options?.signal;
        return Promise.reject(new Error('host failed'));
      },
    };

    const handle = createDocumentModelContext(host).registerTool(TOOL);
    await Promise.resolve();
    expect(controllerRef.signal?.aborted).toBe(false);
    handle.unregister();
    expect(controllerRef.signal?.aborted).toBe(true);
  });
});
