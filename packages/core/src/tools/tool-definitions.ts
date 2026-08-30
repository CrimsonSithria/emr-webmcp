import type { EmrCapability } from '../contracts/capabilities.js';
import { TOOL_SCHEMAS } from './tool-schemas.js';

export type SafetyClass = 'read' | 'navigate' | 'draft';

export const TOOL_NAMES = [
  'get_active_patient',
  'search_patients',
  'list_clinic_appointments',
  'get_chart_brief',
  'find_unlatched_abnormal_results',
  'get_result_context',
  'list_open_followups',
  'list_followup_assignees',
  'stage_followup_task',
  'open_review_queue',
  'open_patient_chart',
  'open_result_or_followup',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export type ToolDefinition = {
  readonly name: ToolName;
  readonly description: string;
  readonly safetyClass: SafetyClass;
  readonly requiredCapabilities: readonly EmrCapability[];
  readonly inputSchema: object;
};

function defineTool(definition: ToolDefinition): ToolDefinition {
  return Object.freeze(definition);
}

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = Object.freeze([
  defineTool({
    name: 'get_active_patient',
    description: 'Returns the patient represented by the current O3 route, or `null`.',
    safetyClass: 'read',
    requiredCapabilities: Object.freeze([]),
    inputSchema: TOOL_SCHEMAS.get_active_patient,
  }),
  defineTool({
    name: 'search_patients',
    description: 'Searches authorized patients with a required query and maximum result count of 20.',
    safetyClass: 'read',
    requiredCapabilities: Object.freeze(['search-patients']),
    inputSchema: TOOL_SCHEMAS.search_patients,
  }),
  defineTool({
    name: 'list_clinic_appointments',
    description: 'Lists appointments within a required bounded date window of at most seven days.',
    safetyClass: 'read',
    requiredCapabilities: Object.freeze(['list-appointments']),
    inputSchema: TOOL_SCHEMAS.list_clinic_appointments,
  }),
  defineTool({
    name: 'get_chart_brief',
    description:
      'Returns conditions, allergies, medications, recent vitals, recent results, and open tasks for one patient.',
    safetyClass: 'read',
    requiredCapabilities: Object.freeze(['get-chart-brief']),
    inputSchema: TOOL_SCHEMAS.get_chart_brief,
  }),
  defineTool({
    name: 'find_unlatched_abnormal_results',
    description: 'Returns abnormal results with no matching active LabLatch Task, capped at 100 results.',
    safetyClass: 'read',
    requiredCapabilities: Object.freeze(['list-abnormal-results']),
    inputSchema: TOOL_SCHEMAS.find_unlatched_abnormal_results,
  }),
  defineTool({
    name: 'get_result_context',
    description: 'Returns one result plus existing follow-up context.',
    safetyClass: 'read',
    requiredCapabilities: Object.freeze(['get-result']),
    inputSchema: TOOL_SCHEMAS.get_result_context,
  }),
  defineTool({
    name: 'list_open_followups',
    description: 'Lists bounded open tasks filtered by patient, assignee, priority, or overdue state.',
    safetyClass: 'read',
    requiredCapabilities: Object.freeze(['list-followups']),
    inputSchema: TOOL_SCHEMAS.list_open_followups,
  }),
  defineTool({
    name: 'list_followup_assignees',
    description: 'Lists assignable providers and roles available to the current user.',
    safetyClass: 'read',
    requiredCapabilities: Object.freeze(['list-assignees']),
    inputSchema: TOOL_SCHEMAS.list_followup_assignees,
  }),
  defineTool({
    name: 'stage_followup_task',
    description:
      'Validates and stores one transient `FollowupDraft`; it does not call the EMR write endpoint.',
    safetyClass: 'draft',
    requiredCapabilities: Object.freeze(['create-followup']),
    inputSchema: TOOL_SCHEMAS.stage_followup_task,
  }),
  defineTool({
    name: 'open_review_queue',
    description: "Opens the module's visible draft-review workspace.",
    safetyClass: 'navigate',
    requiredCapabilities: Object.freeze(['navigate-review-queue']),
    inputSchema: TOOL_SCHEMAS.open_review_queue,
  }),
  defineTool({
    name: 'open_patient_chart',
    description: 'Opens the native patient chart route.',
    safetyClass: 'navigate',
    requiredCapabilities: Object.freeze(['navigate-patient-chart']),
    inputSchema: TOOL_SCHEMAS.open_patient_chart,
  }),
  defineTool({
    name: 'open_result_or_followup',
    description: 'Opens the native Tests dashboard or Task workspace.',
    safetyClass: 'navigate',
    requiredCapabilities: Object.freeze(['navigate-tests', 'navigate-tasks']),
    inputSchema: TOOL_SCHEMAS.open_result_or_followup,
  }),
]);
