/// <reference lib="dom" />

import { AdapterError } from '../contracts/adapter-error.js';
import type { EmrCapability } from '../contracts/capabilities.js';
import {
  errorResult,
  successResult,
  type ToolResult,
  type ToolResultDeps,
} from '../contracts/tool-result.js';
import type { ModelContext } from './model-context.js';
import type { ToolName } from './tool-definitions.js';
import { selectEligibleTools } from './tool-policy.js';
import { validateToolInput } from './tool-schemas.js';

export type RegistrationContext = {
  userId: string;
  capabilities: ReadonlySet<EmrCapability>;
  privileges: ReadonlySet<string>;
  routeContext: string;
};

export type ToolHandler = (input: unknown, signal: AbortSignal) => Promise<unknown>;

export type ToolRuntime = { readonly [Name in ToolName]: ToolHandler };

export type RegistrationManagerOptions = {
  modelContext: ModelContext;
  runtime: ToolRuntime;
  deps: ToolResultDeps;
};

type ActiveRegistration = {
  name: ToolName;
  controller: AbortController;
  unregister: () => void;
};

const UNAUTHORIZED_MESSAGE = 'Not authorized to invoke this tool.';
const INVALID_INPUT_MESSAGE = 'Input did not match the tool schema.';
const UPSTREAM_MESSAGE = 'Upstream request failed';

function fingerprintOf(context: RegistrationContext): string {
  return [
    context.userId,
    [...context.privileges].sort().join('\0'),
    [...context.capabilities].sort().join('\0'),
    context.routeContext,
  ].join('\n');
}

export class RegistrationManager {
  private readonly modelContext: ModelContext;
  private readonly runtime: ToolRuntime;
  private readonly deps: ToolResultDeps;
  private context: RegistrationContext | null = null;
  private fingerprint: string | null = null;
  private registrations: ActiveRegistration[] = [];

  constructor(options: RegistrationManagerOptions) {
    this.modelContext = options.modelContext;
    this.runtime = options.runtime;
    this.deps = options.deps;
  }

  update(context: RegistrationContext): void {
    const nextFingerprint = fingerprintOf(context);
    this.context = context;
    if (this.fingerprint === nextFingerprint) {
      return;
    }
    this.replace(nextFingerprint);
  }

  logout(): void {
    this.teardown();
  }

  userChange(): void {
    this.teardown();
  }

  unmount(): void {
    this.teardown();
  }

  private replace(nextFingerprint: string): void {
    this.teardownRegistrations();
    this.fingerprint = nextFingerprint;
    if (this.context === null) {
      return;
    }
    for (const tool of selectEligibleTools(this.context)) {
      const controller = new AbortController();
      const name = tool.name;
      const { unregister } = this.modelContext.registerTool({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        execute: (input, hostSignal) =>
          this.executeTool(name, input, controller.signal, hostSignal),
      });
      this.registrations.push({ name, controller, unregister });
    }
  }

  private teardown(): void {
    this.teardownRegistrations();
    this.context = null;
    this.fingerprint = null;
  }

  private teardownRegistrations(): void {
    const current = this.registrations;
    this.registrations = [];
    for (const registration of current) {
      registration.controller.abort();
    }
    for (const registration of current) {
      registration.unregister();
    }
  }

  private isAuthorized(name: ToolName): boolean {
    if (this.context === null) {
      return false;
    }
    return selectEligibleTools(this.context).some((tool) => tool.name === name);
  }

  private unauthorized(): ToolResult<never> {
    return errorResult(this.deps, {
      code: 'unauthorized',
      message: UNAUTHORIZED_MESSAGE,
      retryable: false,
    });
  }

  private async executeTool(
    name: ToolName,
    input: unknown,
    childSignal: AbortSignal,
    hostSignal: AbortSignal,
  ): Promise<ToolResult<unknown>> {
    if (childSignal.aborted || hostSignal.aborted || !this.isAuthorized(name)) {
      return this.unauthorized();
    }

    const parsed = validateToolInput(name, input);
    if (!parsed.ok) {
      return errorResult(this.deps, {
        code: 'invalid-input',
        message: INVALID_INPUT_MESSAGE,
        retryable: false,
      });
    }

    try {
      const data = await this.runtime[name](parsed.value, childSignal);
      if (childSignal.aborted || hostSignal.aborted || !this.isAuthorized(name)) {
        return this.unauthorized();
      }
      return successResult(this.deps, data);
    } catch (error) {
      if (childSignal.aborted || hostSignal.aborted) {
        return this.unauthorized();
      }
      if (error instanceof AdapterError) {
        return errorResult(this.deps, {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
        });
      }
      return errorResult(this.deps, {
        code: 'upstream',
        message: UPSTREAM_MESSAGE,
        retryable: true,
      });
    }
  }
}
