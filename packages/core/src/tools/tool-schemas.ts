import { z } from 'zod';

const queryText = z.string().min(1).max(200);
const identifier = z.string().min(1).max(200);
const titleText = z.string().min(1).max(200);
const rationaleText = z.string().min(1).max(2000);
const priority = z.enum(['low', 'medium', 'high']);
const dateTime = z.iso.datetime();

const patientRef = z.strictObject({
  id: identifier,
  display: identifier,
});

const assignee = z.strictObject({
  id: identifier,
  display: identifier,
  type: z.enum(['person', 'role']),
});

const emptyInput = z.strictObject({});

const zodSchemas = {
  get_active_patient: emptyInput,
  search_patients: z.strictObject({
    query: queryText,
    limit: z.int().min(1).max(20),
  }),
  list_clinic_appointments: z.strictObject({
    start: dateTime,
    end: dateTime,
  }),
  get_chart_brief: z.strictObject({
    patientId: identifier,
  }),
  find_unlatched_abnormal_results: z.strictObject({
    limit: z.int().min(1).max(100),
    patientId: identifier.optional(),
    cursor: identifier.optional(),
  }),
  get_result_context: z.strictObject({
    resultId: identifier,
  }),
  list_open_followups: z.strictObject({
    limit: z.int().min(1).max(100),
    patientId: identifier.optional(),
    assigneeId: identifier.optional(),
    priority: priority.optional(),
    overdueOnly: z.boolean().optional(),
    cursor: identifier.optional(),
  }),
  list_followup_assignees: z.strictObject({
    query: queryText,
    limit: z.int().min(1).max(20),
  }),
  stage_followup_task: z.strictObject({
    draftId: identifier.optional(),
    patient: patientRef,
    title: titleText,
    rationale: rationaleText,
    priority,
    dueAt: dateTime.optional(),
    assignee: assignee.optional(),
    sourceReference: identifier.optional(),
  }),
  open_review_queue: emptyInput,
  open_patient_chart: z.strictObject({
    patientId: identifier,
  }),
  open_result_or_followup: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('tests-dashboard'),
      patientId: identifier.optional(),
    }),
    z.strictObject({
      kind: z.literal('task-workspace'),
      taskId: identifier,
    }),
  ]),
} as const;

export type ToolSchemaName = keyof typeof zodSchemas;

export const TOOL_SCHEMAS: { readonly [K in ToolSchemaName]: object } = {
  get_active_patient: z.toJSONSchema(zodSchemas.get_active_patient),
  search_patients: z.toJSONSchema(zodSchemas.search_patients),
  list_clinic_appointments: z.toJSONSchema(zodSchemas.list_clinic_appointments),
  get_chart_brief: z.toJSONSchema(zodSchemas.get_chart_brief),
  find_unlatched_abnormal_results: z.toJSONSchema(zodSchemas.find_unlatched_abnormal_results),
  get_result_context: z.toJSONSchema(zodSchemas.get_result_context),
  list_open_followups: z.toJSONSchema(zodSchemas.list_open_followups),
  list_followup_assignees: z.toJSONSchema(zodSchemas.list_followup_assignees),
  stage_followup_task: z.toJSONSchema(zodSchemas.stage_followup_task),
  open_review_queue: z.toJSONSchema(zodSchemas.open_review_queue),
  open_patient_chart: z.toJSONSchema(zodSchemas.open_patient_chart),
  open_result_or_followup: z.toJSONSchema(zodSchemas.open_result_or_followup),
};

export function validateToolInput(
  name: ToolSchemaName,
  input: unknown,
): { ok: true; value: unknown } | { ok: false } {
  const parsed = zodSchemas[name].safeParse(input);
  if (!parsed.success) {
    return { ok: false };
  }
  return { ok: true, value: parsed.data };
}
