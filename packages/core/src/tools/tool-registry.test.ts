import { describe, expect, it } from 'vitest';

import type { EmrCapability } from '../contracts/capabilities.js';
import { selectEligibleTools } from './tool-policy.js';
import { TOOL_DEFINITIONS, type SafetyClass, type ToolDefinition } from './tool-definitions.js';
import { TOOL_SCHEMAS } from './tool-schemas.js';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
type Expect<T extends true> = T;

type JsonSchema = Record<string, unknown> & {
  type?: string;
  additionalProperties?: boolean;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  maxLength?: number;
  maximum?: number;
  format?: string;
  enum?: readonly string[];
  oneOf?: readonly JsonSchema[];
  anyOf?: readonly JsonSchema[];
};

type ToolCase = {
  name: string;
  safetyClass: SafetyClass;
  requiredCapabilities: readonly EmrCapability[];
  description: string;
  required?: readonly string[];
  stringMax?: Readonly<Record<string, number>>;
  collectionMax?: Readonly<Record<string, number>>;
  dateTime?: readonly string[];
};

const ALL_CAPABILITIES: readonly EmrCapability[] = [
  'search-patients',
  'list-appointments',
  'get-chart-brief',
  'list-abnormal-results',
  'get-result',
  'list-followups',
  'list-assignees',
  'create-followup',
  'navigate-patient-chart',
  'navigate-tests',
  'navigate-tasks',
  'navigate-review-queue',
];

const TOOL_CASES: readonly ToolCase[] = [
  {
    name: 'get_active_patient',
    safetyClass: 'read',
    requiredCapabilities: [],
    description: 'Returns the patient represented by the current O3 route, or `null`.',
  },
  {
    name: 'search_patients',
    safetyClass: 'read',
    requiredCapabilities: ['search-patients'],
    description: 'Searches authorized patients with a required query and maximum result count of 20.',
    required: ['query', 'limit'],
    stringMax: { query: 200 },
    collectionMax: { limit: 20 },
  },
  {
    name: 'list_clinic_appointments',
    safetyClass: 'read',
    requiredCapabilities: ['list-appointments'],
    description: 'Lists appointments within a required bounded date window of at most seven days.',
    required: ['start', 'end'],
    dateTime: ['start', 'end'],
  },
  {
    name: 'get_chart_brief',
    safetyClass: 'read',
    requiredCapabilities: ['get-chart-brief'],
    description:
      'Returns conditions, allergies, medications, recent vitals, recent results, and open tasks for one patient.',
    required: ['patientId'],
    stringMax: { patientId: 200 },
  },
  {
    name: 'find_unlatched_abnormal_results',
    safetyClass: 'read',
    requiredCapabilities: ['list-abnormal-results'],
    description: 'Returns abnormal results with no matching active LabLatch Task, capped at 100 results.',
    required: ['limit'],
    collectionMax: { limit: 100 },
    stringMax: { patientId: 200, cursor: 200 },
  },
  {
    name: 'get_result_context',
    safetyClass: 'read',
    requiredCapabilities: ['get-result'],
    description: 'Returns one result plus existing follow-up context.',
    required: ['resultId'],
    stringMax: { resultId: 200 },
  },
  {
    name: 'list_open_followups',
    safetyClass: 'read',
    requiredCapabilities: ['list-followups'],
    description: 'Lists bounded open tasks filtered by patient, assignee, priority, or overdue state.',
    required: ['limit'],
    collectionMax: { limit: 100 },
    stringMax: { patientId: 200, assigneeId: 200, cursor: 200 },
  },
  {
    name: 'list_followup_assignees',
    safetyClass: 'read',
    requiredCapabilities: ['list-assignees'],
    description: 'Lists assignable providers and roles available to the current user.',
    required: ['query', 'limit'],
    stringMax: { query: 200 },
    collectionMax: { limit: 20 },
  },
  {
    name: 'stage_followup_task',
    safetyClass: 'draft',
    requiredCapabilities: ['create-followup'],
    description:
      'Validates and stores one transient `FollowupDraft`; it does not call the EMR write endpoint.',
    required: ['draftId', 'patient', 'title', 'rationale', 'priority'],
    stringMax: { draftId: 200, title: 200, rationale: 2000, sourceReference: 200 },
    dateTime: ['dueAt'],
  },
  {
    name: 'open_review_queue',
    safetyClass: 'navigate',
    requiredCapabilities: ['navigate-review-queue'],
    description: "Opens the module's visible draft-review workspace.",
  },
  {
    name: 'open_patient_chart',
    safetyClass: 'navigate',
    requiredCapabilities: ['navigate-patient-chart'],
    description: 'Opens the native patient chart route.',
    required: ['patientId'],
    stringMax: { patientId: 200 },
  },
  {
    name: 'open_result_or_followup',
    safetyClass: 'navigate',
    requiredCapabilities: ['navigate-tests', 'navigate-tasks'],
    description: 'Opens the native Tests dashboard or Task workspace.',
    required: ['kind'],
    stringMax: { patientId: 200, taskId: 200 },
  },
];

function definitionNamed(name: string): ToolDefinition {
  const definition = TOOL_DEFINITIONS.find((item) => item.name === name);
  if (definition === undefined) {
    throw new Error(`missing tool definition ${name}`);
  }
  return definition;
}

function schemaNamed(name: string): object {
  const schema = TOOL_SCHEMAS[name as keyof typeof TOOL_SCHEMAS];
  if (schema === undefined) {
    throw new Error(`missing tool schema ${name}`);
  }
  return schema;
}

function inspectSchema(value: object): JsonSchema {
  const copy: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    copy[key] = entry;
  }
  return copy;
}

function propertyAt(schema: JsonSchema, path: string): JsonSchema {
  const parts = path.split('.');
  let current: JsonSchema = schema;
  for (const part of parts) {
    const next = current.properties?.[part];
    if (next === undefined) {
      throw new Error(`missing schema property ${path}`);
    }
    current = next;
  }
  return current;
}

function assertClosedObjects(schema: JsonSchema, path: string): void {
  if (schema.type === 'object' || schema.properties !== undefined) {
    expect(schema.additionalProperties, path).toBe(false);
  }
  if (schema.properties !== undefined) {
    for (const [key, child] of Object.entries(schema.properties)) {
      assertClosedObjects(child, `${path}.${key}`);
    }
  }
  for (const item of schema.oneOf ?? []) {
    assertClosedObjects(item, `${path}.oneOf`);
  }
  for (const item of schema.anyOf ?? []) {
    assertClosedObjects(item, `${path}.anyOf`);
  }
}

describe('tool registry', () => {
  it('locks safety classes to read, navigate, and draft', () => {
    type Allowed = Expect<Equal<SafetyClass, 'read' | 'navigate' | 'draft'>>;
    const check: Allowed = true;
    expect(check).toBe(true);
  });

  it('registers exactly the twelve spec section 9 tools', () => {
    expect(TOOL_DEFINITIONS).toHaveLength(12);
    expect(TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual(TOOL_CASES.map((tool) => tool.name));
    expect(Object.keys(TOOL_SCHEMAS)).toEqual(TOOL_CASES.map((tool) => tool.name));
  });

  it('does not register a Commit tool or createFollowup write surface', () => {
    const names = TOOL_DEFINITIONS.map((tool) => tool.name);
    const classes = TOOL_DEFINITIONS.map((tool) => tool.safetyClass);

    expect(classes).not.toContain('commit');
    expect(names).not.toContain('createFollowup');
    expect(names).not.toContain('create_followup');
    expect(names).not.toContain('confirm_followup');
    expect(names.some((name) => name.toLowerCase().includes('commit'))).toBe(false);
  });

  it.each(TOOL_CASES)(
    '$name is a $safetyClass tool with a closed bounded schema',
    (toolCase) => {
      const definition = definitionNamed(toolCase.name);
      const schema = inspectSchema(schemaNamed(toolCase.name));

      expect(definition.description).toBe(toolCase.description);
      expect(definition.safetyClass).toBe(toolCase.safetyClass);
      expect([...definition.requiredCapabilities]).toEqual([...toolCase.requiredCapabilities]);
      expect(definition.inputSchema).toBe(schemaNamed(toolCase.name));
      expect(schema.type).toBe('object');
      assertClosedObjects(schema, toolCase.name);

      if (toolCase.required !== undefined) {
        expect([...(schema.required ?? [])].sort()).toEqual([...toolCase.required].sort());
      }

      if (toolCase.stringMax !== undefined) {
        for (const [field, maxLength] of Object.entries(toolCase.stringMax)) {
          expect(propertyAt(schema, field).maxLength).toBe(maxLength);
        }
      }

      if (toolCase.collectionMax !== undefined) {
        for (const [field, maximum] of Object.entries(toolCase.collectionMax)) {
          expect(propertyAt(schema, field).maximum).toBe(maximum);
        }
      }

      if (toolCase.dateTime !== undefined) {
        for (const field of toolCase.dateTime) {
          expect(propertyAt(schema, field).format).toBe('date-time');
        }
      }
    },
  );

  it('bounds nested FollowupDraft identity fields and enumerates priority', () => {
    const schema = inspectSchema(schemaNamed('stage_followup_task'));
    expect(propertyAt(schema, 'patient.id').maxLength).toBe(200);
    expect(propertyAt(schema, 'patient.display').maxLength).toBe(200);
    expect(propertyAt(schema, 'priority').enum).toEqual(['low', 'medium', 'high']);
    expect(propertyAt(schema, 'assignee.id').maxLength).toBe(200);
    expect(propertyAt(schema, 'assignee.display').maxLength).toBe(200);
    expect(propertyAt(schema, 'assignee.type').enum).toEqual(['person', 'role']);
  });

  it('enumerates open_result_or_followup navigation kinds', () => {
    expect(propertyAt(inspectSchema(schemaNamed('open_result_or_followup')), 'kind').enum).toEqual([
      'tests-dashboard',
      'task-workspace',
    ]);
  });

  it('enumerates list_open_followups priority values', () => {
    expect(propertyAt(inspectSchema(schemaNamed('list_open_followups')), 'priority').enum).toEqual([
      'low',
      'medium',
      'high',
    ]);
  });

  it('keeps tool definitions immutable', () => {
    expect(Object.isFrozen(TOOL_DEFINITIONS)).toBe(true);
    expect(TOOL_DEFINITIONS.every((definition) => Object.isFrozen(definition))).toBe(true);
  });
});

describe('tool policy', () => {
  const privileges = {
    session: new Set(['session']),
    use: new Set(['emr-webmcp.use']),
    both: new Set(['session', 'emr-webmcp.use']),
  };

  function namesFor(
    capabilities: Iterable<EmrCapability>,
    granted: ReadonlySet<string>,
  ): string[] {
    return selectEligibleTools({
      capabilities: new Set(capabilities),
      privileges: granted,
    }).map((tool) => tool.name);
  }

  it('includes get_active_patient when only the session privilege is present', () => {
    expect(namesFor([], privileges.session)).toEqual(['get_active_patient']);
    expect(namesFor(ALL_CAPABILITIES, privileges.session)).toEqual(['get_active_patient']);
  });

  it('omits a tool when any required capability is missing', () => {
    expect(namesFor(['search-patients'], privileges.both)).toEqual([
      'get_active_patient',
      'search_patients',
    ]);
    expect(namesFor(['navigate-tests'], privileges.both)).toEqual(['get_active_patient']);
    expect(namesFor(['navigate-tests', 'navigate-tasks'], privileges.both)).toEqual([
      'get_active_patient',
      'open_result_or_followup',
    ]);
    expect(namesFor(['create-followup'], privileges.both)).toEqual([
      'get_active_patient',
      'stage_followup_task',
    ]);
  });

  it('omits a tool when any required privilege is missing', () => {
    expect(namesFor(ALL_CAPABILITIES, privileges.use)).toEqual(
      TOOL_CASES.filter((tool) => tool.name !== 'get_active_patient').map((tool) => tool.name),
    );
    expect(namesFor(ALL_CAPABILITIES, new Set())).toEqual([]);
    expect(namesFor(['search-patients'], privileges.use)).toEqual(['search_patients']);
  });

  it('returns every tool when capabilities and privileges are complete', () => {
    expect(namesFor(ALL_CAPABILITIES, privileges.both)).toEqual(TOOL_CASES.map((tool) => tool.name));
  });
});
