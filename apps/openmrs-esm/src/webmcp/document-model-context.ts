import type { ModelContext, ModelContextTool } from '@emr-webmcp/core';

export type HostModelContextTool = {
  name: string;
  description: string;
  inputSchema: object;
  execute: (input: unknown, signal?: AbortSignal) => Promise<unknown>;
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

export function createDocumentModelContext(host: HostModelContext): ModelContext {
  return {
    registerTool(tool: ModelContextTool): { unregister: () => void } {
      const controller = new AbortController();
      const result = host.registerTool(
        {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          execute: (input, signal) => tool.execute(input, signal ?? controller.signal),
        },
        { signal: controller.signal },
      );

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

function getHostModelContext(): HostModelContext | null {
  const host = document.modelContext;
  if (host === undefined || typeof host.registerTool !== 'function') {
    return null;
  }
  return host;
}

function hasUnregister(result: unknown): result is { unregister: () => void } {
  return (
    typeof result === 'object' &&
    result !== null &&
    'unregister' in result &&
    typeof result.unregister === 'function'
  );
}
