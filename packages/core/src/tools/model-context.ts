/// <reference lib="dom" />

export type ModelContextTool = {
  name: string;
  description: string;
  inputSchema: object;
  execute: (input: unknown, signal: AbortSignal) => Promise<unknown>;
};

export type ModelContext = {
  registerTool(tool: ModelContextTool): { unregister: () => void };
};
