import type { ModelContext, ModelContextTool } from '@emr-webmcp/core';

export type RegisteredTool = ModelContextTool & { unregister: () => void };

export class FakeModelContext implements ModelContext {
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
    const found = this.tools.find((entry) => entry.name === name);
    if (found === undefined) {
      throw new Error(`tool ${name} is not registered`);
    }
    return found;
  }
}

export function installFakeModelContext(model = new FakeModelContext()): FakeModelContext {
  Object.defineProperty(document, 'modelContext', {
    configurable: true,
    writable: true,
    value: model,
  });
  return model;
}

export function clearModelContext(): void {
  delete (document as Document & { modelContext?: unknown }).modelContext;
}
