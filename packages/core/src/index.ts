export type { EmrAdapter } from './contracts/adapter.js';
export { AdapterError } from './contracts/adapter-error.js';
export type { EmrCapability, EmrNavigationTarget } from './contracts/capabilities.js';
export type {
  AssigneeSummary,
  AppointmentSummary,
  ChartBrief,
  ConfirmedFollowup,
  FollowupDraft,
  FollowupSummary,
  PatientRef,
  ResultSummary,
} from './contracts/dtos.js';
export type { AppointmentQuery, FollowupQuery, ResultQuery } from './contracts/queries.js';
export type {
  PublicToolError,
  SuccessResultOptions,
  ToolErrorCode,
  ToolResult,
  ToolResultDeps,
} from './contracts/tool-result.js';
export { errorResult, successResult } from './contracts/tool-result.js';
export { DraftStore, type DraftStoreOptions } from './drafts/draft-store.js';
export type { ModelContext, ModelContextTool } from './tools/model-context.js';
export type {
  RegistrationContext,
  RegistrationManagerOptions,
  ToolHandler,
  ToolRuntime,
} from './tools/registration-manager.js';
export { RegistrationManager } from './tools/registration-manager.js';
export { selectEligibleTools, type PolicyInputs } from './tools/tool-policy.js';
export { TOOL_SCHEMAS } from './tools/tool-schemas.js';
export {
  TOOL_DEFINITIONS,
  TOOL_NAMES,
  type SafetyClass,
  type ToolDefinition,
  type ToolName,
} from './tools/tool-definitions.js';
