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
