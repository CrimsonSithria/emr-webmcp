export const SCENARIO_COUNT = 25;

export type ScenarioSurface = 'ui' | 'webmcp' | 'both';

export type ScenarioExpected =
  | 'success'
  | 'error-unsupported'
  | 'error-unauthorized'
  | 'blocked-stale'
  | 'blocked-duplicate'
  | 'blocked-offline'
  | 'tools-cleared'
  | 'tools-replaced'
  | 'empty-success'
  | 'truncated-success'
  | 'write-once'
  | 'no-write'
  | 'no-write-without-click';

export type ScenarioSafetyClass = 'read' | 'navigate' | 'draft' | 'confirm' | 'lifecycle';

export type Scenario = {
  readonly id: string;
  readonly expected: ScenarioExpected;
  readonly safetyClass: ScenarioSafetyClass;
  readonly surfaces: ScenarioSurface;
};

export const SCENARIOS: readonly Scenario[] = Object.freeze([
  { id: 'read-active-patient', expected: 'success', safetyClass: 'read', surfaces: 'both' },
  { id: 'read-search-patients', expected: 'success', safetyClass: 'read', surfaces: 'both' },
  { id: 'read-clinic-appointments', expected: 'success', safetyClass: 'read', surfaces: 'both' },
  { id: 'read-chart-brief', expected: 'success', safetyClass: 'read', surfaces: 'both' },
  { id: 'read-unlatched-abnormal-results', expected: 'success', safetyClass: 'read', surfaces: 'both' },
  { id: 'read-result-context', expected: 'success', safetyClass: 'read', surfaces: 'both' },
  { id: 'read-open-followups', expected: 'success', safetyClass: 'read', surfaces: 'both' },
  { id: 'read-followup-assignees', expected: 'success', safetyClass: 'read', surfaces: 'both' },
  { id: 'navigate-patient-chart', expected: 'success', safetyClass: 'navigate', surfaces: 'both' },
  { id: 'navigate-review-queue', expected: 'success', safetyClass: 'navigate', surfaces: 'both' },
  { id: 'unsupported-capability', expected: 'error-unsupported', safetyClass: 'read', surfaces: 'both' },
  { id: 'unauthorized-read', expected: 'error-unauthorized', safetyClass: 'read', surfaces: 'both' },
  { id: 'stale-draft', expected: 'blocked-stale', safetyClass: 'draft', surfaces: 'both' },
  { id: 'duplicate-correlation', expected: 'blocked-duplicate', safetyClass: 'draft', surfaces: 'both' },
  { id: 'offline-confirm', expected: 'blocked-offline', safetyClass: 'draft', surfaces: 'both' },
  { id: 'logout-teardown', expected: 'tools-cleared', safetyClass: 'lifecycle', surfaces: 'both' },
  { id: 'route-change', expected: 'tools-replaced', safetyClass: 'lifecycle', surfaces: 'both' },
  { id: 'empty-clinic-reads', expected: 'empty-success', safetyClass: 'read', surfaces: 'both' },
  { id: 'large-clinic-bounded-read', expected: 'truncated-success', safetyClass: 'read', surfaces: 'both' },
  { id: 'abnormal-result-high', expected: 'success', safetyClass: 'read', surfaces: 'both' },
  { id: 'abnormal-result-critical', expected: 'success', safetyClass: 'read', surfaces: 'both' },
  { id: 'abnormal-result-unlatched', expected: 'success', safetyClass: 'read', surfaces: 'both' },
  { id: 'human-confirm-followup', expected: 'write-once', safetyClass: 'confirm', surfaces: 'both' },
  { id: 'draft-stages-without-write', expected: 'no-write', safetyClass: 'draft', surfaces: 'both' },
  {
    id: 'confirm-requires-visible-click',
    expected: 'no-write-without-click',
    safetyClass: 'confirm',
    surfaces: 'ui',
  },
]);

const REQUIRED_ID_PATTERNS = [
  /read-/,
  /unsupported/,
  /unauthorized/,
  /stale/,
  /duplicate/,
  /offline/,
  /logout/,
  /route-change/,
  /empty-clinic/,
  /large-clinic/,
  /abnormal-result/,
  /confirm/,
] as const;

export function assertManifestIntegrity(scenarios: readonly Scenario[] = SCENARIOS): void {
  if (scenarios.length !== SCENARIO_COUNT) {
    throw new Error(`expected exactly ${SCENARIO_COUNT} scenarios, received ${scenarios.length}`);
  }
  const ids = scenarios.map((scenario) => scenario.id);
  if (new Set(ids).size !== SCENARIO_COUNT) {
    throw new Error('scenario ids must be unique');
  }
  for (const pattern of REQUIRED_ID_PATTERNS) {
    if (!ids.some((id) => pattern.test(id))) {
      throw new Error(`scenario manifest is missing required class ${pattern.source}`);
    }
  }
}

export function assertSurfaceCoverage(
  sources: { readonly ui: string; readonly webmcp: string },
  scenarios: readonly Scenario[] = SCENARIOS,
): void {
  assertManifestIntegrity(scenarios);
  const missing: string[] = [];
  for (const scenario of scenarios) {
    const needsUi = scenario.surfaces === 'ui' || scenario.surfaces === 'both';
    const needsWebmcp = scenario.surfaces === 'webmcp' || scenario.surfaces === 'both';
    if (needsUi && !sources.ui.includes(scenario.id)) {
      missing.push(`${scenario.id} missing ui coverage`);
    }
    if (needsWebmcp && !sources.webmcp.includes(scenario.id)) {
      missing.push(`${scenario.id} missing webmcp coverage`);
    }
  }
  if (missing.length > 0) {
    throw new Error(`scenario coverage incomplete: ${missing.join('; ')}`);
  }
}

export const SYNTHETIC_DRAFT = {
  draftId: 'caller-draft-id',
  patient: { id: 'patient-1', display: 'Ada Lovelace' },
  title: 'Follow up potassium',
  rationale: 'Repeat the BMP in clinic after the high potassium result.',
  priority: 'high',
  dueAt: '2026-09-01T09:00:00.000Z',
  assignee: { id: 'person-dr-chen', display: 'Dr. Chen', type: 'person' },
  sourceReference: 'Observation/obs-1',
} as const;
