import type { ModelContext, ModelContextTool } from '@emr-webmcp/core';

export type HostExecuteOptions = {
  signal?: AbortSignal;
};

export type HostModelContextTool = {
  name: string;
  description: string;
  inputSchema: object;
  execute: (
    input: unknown,
    signalOrOptions?: AbortSignal | HostExecuteOptions,
  ) => Promise<unknown>;
};

export type HostModelContext = {
  registerTool(
    tool: HostModelContextTool,
    options?: { signal?: AbortSignal },
  ): { unregister?: () => void } | void | Promise<unknown>;
  unregisterTool?(name: string): void;
};

declare global {
  interface Document {
    modelContext?: HostModelContext;
  }
  interface Navigator {
    modelContext?: HostModelContext;
  }
}

export function hasDocumentModelContext(): boolean {
  return getHostModelContext() !== null;
}

export function getDocumentModelContext(): ModelContext | null {
  const host = getHostModelContext();
  if (host === null) {
    return null;
  }
  return createDocumentModelContext(host);
}

export function hostExecuteSignal(second: unknown): AbortSignal | undefined {
  if (second instanceof AbortSignal) {
    return second;
  }
  if (typeof second === 'object' && second !== null && 'signal' in second) {
    const signal = (second as { signal?: unknown }).signal;
    if (signal instanceof AbortSignal) {
      return signal;
    }
  }
  return undefined;
}

export function createDocumentModelContext(host: HostModelContext): ModelContext {
  return {
    registerTool(tool: ModelContextTool): { unregister: () => void } {
      const controller = new AbortController();
      const result = host.registerTool(
        {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          execute: (input, second) =>
            tool.execute(input, hostExecuteSignal(second) ?? controller.signal),
        },
        { signal: controller.signal },
      );

      void Promise.resolve(result).catch(() => undefined);

      return {
        unregister: () => {
          controller.abort();
          if (hasUnregister(result)) {
            result.unregister();
            return;
          }
          if (typeof host.unregisterTool === 'function') {
            host.unregisterTool(tool.name);
          }
        },
      };
    },
  };
}

export function getHostModelContext(): HostModelContext | null {
  // Chrome 146-151 shipped the API on navigator; 152+ moved it to document.
  const candidates: (HostModelContext | undefined)[] = [
    document.modelContext,
    typeof navigator === 'undefined' ? undefined : navigator.modelContext,
  ];
  for (const host of candidates) {
    if (host !== undefined && host !== null && typeof host.registerTool === 'function') {
      return host;
    }
  }
  return null;
}

function hasUnregister(result: unknown): result is { unregister: () => void } {
  return (
    typeof result === 'object' &&
    result !== null &&
    !isThenable(result) &&
    'unregister' in result &&
    typeof result.unregister === 'function'
  );
}

function isThenable(value: object): boolean {
  return 'then' in value && typeof (value as { then?: unknown }).then === 'function';
}
