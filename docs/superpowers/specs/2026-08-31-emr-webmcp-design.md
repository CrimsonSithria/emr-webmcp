# EMR WebMCP Design Specification

**Status:** Proposed for implementation

**Date:** 2026-08-31

**Repository:** `emr-webmcp`

**Reference EMR:** OpenMRS 3 (O3)

**Deployment target:** Crimson Prime

**Demonstration data:** Synthetic only

## 1. Product thesis

Health systems already have systems of record, but much of the work surrounding those systems still
requires people to search, reconcile, navigate, and repeatedly enter data through complex screens.
EMR WebMCP adds a browser-native, structured tool surface over an existing EMR so an authorized agent
can perform that preparation work without replacing the EMR, bypassing its permissions, or forking its
core source code.

OpenMRS is the first reference implementation because it is open source, modular, deployed at large
scale, and built for health systems in resource-constrained settings. The architecture is deliberately
adapter-based: shared tool contracts and workflow packs remain EMR-neutral, while each adapter maps
those contracts onto the target system's native web context, API, terminology, and confirmation UI.

The product must be described honestly:

> A reusable WebMCP surface designed for extensible web EMRs, proven first on OpenMRS 3.

It must not be described as compatible with every EMR until a second real adapter passes the same
contract suite.

## 2. Goals

1. Register useful WebMCP tools in the top-level OpenMRS O3 application.
2. Let an agent search, assemble context, stage drafts, and navigate across common clinic workflows.
3. Preserve the logged-in user's OpenMRS permissions and native clinical confirmation screens.
4. Keep OpenMRS core and upstream O3 repositories unmodified.
5. Separate reusable contracts and workflows from the OpenMRS-specific adapter.
6. Demonstrate realistic record volume, operational backlog, live activity, and concurrent load using
   synthetic data.
7. Produce reproducible evidence comparing manual UI use, browser actuation, and WebMCP tool use.
8. Deploy a public HTTPS demonstration instance on Crimson Prime without taking over its existing edge
   ports or weakening its other services.

## 3. Non-goals

- Autonomous diagnosis, treatment selection, prescribing, or patient communication.
- A generic `call_emr_api`, arbitrary SQL, arbitrary FHIR query, or arbitrary REST request tool.
- A replacement UI for all OpenMRS functionality.
- Modifying, forking, or maintaining a private patch set against OpenMRS core.
- Importing real patient data or logging protected health information.
- Claiming production clinical certification or universal EMR compatibility.
- Building a custom backend when the target EMR already exposes the required capability.
- Implementing a complete second EMR adapter in the initial hackathon release.

## 4. Terminology

- **Agent surface:** The WebMCP tools active in the browser for the current EMR page and user.
- **Core:** EMR-neutral TypeScript contracts, registration helpers, policies, and telemetry.
- **Adapter:** Target-specific implementation of canonical capabilities.
- **Workflow pack:** A set of tools and UI orchestration for one operational goal.
- **Draft:** Transient, reviewable proposed state that has not changed the EMR.
- **Commit:** A durable write to the EMR system of record.
- **Native confirmation:** A visible action performed in the target EMR's own authenticated UI.
- **Unlatched result:** An abnormal laboratory Observation with no matching active follow-up Task.
- **LabLatch:** The result-safety workflow pack, not the platform name.

## 5. Architecture

The implementation is a TypeScript monorepo with four primary layers:

1. `packages/core` defines canonical types, adapter interfaces, WebMCP registration, safety policy,
   result envelopes, and privacy-aware telemetry.
2. `packages/adapters/openmrs` implements those interfaces using the current OpenMRS session,
   `openmrsFetch`, FHIR R4 endpoints, REST endpoints, O3 routing, and native workspaces.
3. `packages/workflows/*` composes canonical capabilities into clinic-preparation, coordination, and
   LabLatch toolpacks without importing OpenMRS-specific code.
4. `apps/openmrs-esm` is the O3 frontend module that loads the adapter, registers eligible tools,
   renders the review queue, and opens native O3 pages/workspaces.

Supporting directories contain the custom OpenMRS distribution, deployment definitions, simulation,
tests, and evaluation evidence.

The runtime path is:

1. The clinician authenticates to OpenMRS normally.
2. O3 loads `@emr-webmcp/esm-agent-surface-app` through its import map and routes registry.
3. The module reads route context and current privileges from O3.
4. The adapter advertises only capabilities supported by the current distribution and user.
5. The core registers corresponding tools with `document.modelContext.registerTool()`.
6. A browser agent discovers and invokes a structured tool.
7. Read and navigation tools use the existing OpenMRS session and return bounded structured results.
8. Draft tools validate inputs and place proposed actions in an in-browser review store.
9. The module opens a visible O3 review workspace.
10. The clinician edits, confirms, or discards the draft.
11. Only confirmation calls the native OpenMRS endpoint and creates durable state.

## 6. Repository structure

```text
emr-webmcp/
├── apps/
│   └── openmrs-esm/                 # O3 frontend module and review UI
├── packages/
│   ├── core/                        # Canonical contracts, registry, policy, telemetry
│   ├── adapters/
│   │   ├── openmrs/                 # First real adapter
│   │   └── contract-fixture/        # Fake adapter proving portability in tests
│   └── workflows/
│       ├── clinic-prep/             # Appointment and chart-preparation workflow
│       ├── coordination/            # Navigation, follow-up, and task staging
│       └── lablatch/                # Result ownership and overdue rescue
├── distribution/openmrs/            # Reproducible custom O3 distribution
├── deploy/crimson-prime/             # Compose, edge metadata, health checks, operations
├── simulation/                       # Synthetic records, backlog, event pump, load profiles
├── tests/
│   ├── contract/                    # Runs every adapter against the same expectations
│   ├── browser/                     # Playwright WebMCP and human-gate scenarios
│   └── load/                        # k6 protocol/browser workloads
└── docs/superpowers/                # Reviewed specs and execution plans
```

Every production file has one responsibility. Workflow packages consume the adapter interface; they
must not call OpenMRS endpoints directly.

## 7. Canonical adapter contract

The core contract uses small DTOs instead of exposing raw target-system payloads:

```ts
export type PatientRef = {
  id: string;
  display: string;
};

export type AppointmentSummary = {
  id: string;
  patient: PatientRef;
  start: string;
  status: 'scheduled' | 'checked-in' | 'completed' | 'cancelled' | 'unknown';
  service?: string;
};

export type ResultSummary = {
  id: string;
  patient: PatientRef;
  name: string;
  value?: string;
  unit?: string;
  observedAt: string;
  interpretation: 'critical-low' | 'low' | 'normal' | 'high' | 'critical-high' | 'unknown';
  referenceRange?: string;
  sourceReference: string;
};

export type FollowupSummary = {
  id: string;
  patient: PatientRef;
  title: string;
  status: 'not-started' | 'in-progress' | 'completed' | 'cancelled' | 'unknown';
  priority: 'low' | 'medium' | 'high';
  dueAt?: string;
  assignee?: { id: string; display: string; type: 'person' | 'role' };
  sourceReference?: string;
};

export type FollowupDraft = {
  draftId: string;
  patient: PatientRef;
  title: string;
  rationale: string;
  priority: 'low' | 'medium' | 'high';
  dueAt?: string;
  assignee?: { id: string; display: string; type: 'person' | 'role' };
  sourceReference?: string;
};
```

The required interface is:

```ts
export interface EmrAdapter {
  readonly id: string;
  getCapabilities(): Promise<ReadonlySet<EmrCapability>>;
  getActivePatient(): Promise<PatientRef | null>;
  searchPatients(query: string, limit: number): Promise<PatientRef[]>;
  listAppointments(input: AppointmentQuery): Promise<AppointmentSummary[]>;
  getChartBrief(patientId: string): Promise<ChartBrief>;
  listAbnormalResults(input: ResultQuery): Promise<ResultSummary[]>;
  getResult(resultId: string): Promise<ResultSummary>;
  listFollowups(input: FollowupQuery): Promise<FollowupSummary[]>;
  listAssignees(query: string, limit: number): Promise<AssigneeSummary[]>;
  createFollowup(input: ConfirmedFollowup): Promise<FollowupSummary>;
  navigate(target: EmrNavigationTarget): Promise<void>;
}
```

`createFollowup()` is adapter functionality, not a directly registered WebMCP tool. It is called only
from the native review workspace after explicit user confirmation.

## 8. Tool result envelope

Every WebMCP tool returns the same serializable envelope:

```ts
export type ToolResult<T> = {
  ok: boolean;
  data?: T;
  error?: {
    code: 'unauthorized' | 'unsupported' | 'not-found' | 'invalid-input' | 'conflict' | 'upstream';
    message: string;
    retryable: boolean;
  };
  meta: {
    invocationId: string;
    adapterId: string;
    generatedAt: string;
    truncated: boolean;
    nextCursor?: string;
  };
};
```

Tool errors must be factual and actionable. They must not include raw response bodies, credentials,
stack traces, or patient details beyond the requested result.

## 9. MVP WebMCP surface

The initial release registers only read, navigation, and transient-draft tools:

| Tool | Safety class | Behavior |
|---|---|---|
| `get_active_patient` | Read | Returns the patient represented by the current O3 route, or `null`. |
| `search_patients` | Read | Searches authorized patients with a required query and maximum result count of 20. |
| `list_clinic_appointments` | Read | Lists appointments within a required bounded date window of at most seven days. |
| `get_chart_brief` | Read | Returns conditions, allergies, medications, recent vitals, recent results, and open tasks for one patient. |
| `find_unlatched_abnormal_results` | Read | Returns abnormal results with no matching active LabLatch Task, capped at 100 results. |
| `get_result_context` | Read | Returns one result plus existing follow-up context. |
| `list_open_followups` | Read | Lists bounded open tasks filtered by patient, assignee, priority, or overdue state. |
| `list_followup_assignees` | Read | Lists assignable providers and roles available to the current user. |
| `stage_followup_task` | Draft | Validates and stores one transient `FollowupDraft`; it does not call the EMR write endpoint. |
| `open_review_queue` | Navigation | Opens the module's visible draft-review workspace. |
| `open_patient_chart` | Navigation | Opens the native patient chart route. |
| `open_result_or_followup` | Navigation | Opens the native Tests dashboard or Task workspace. |

Tool names and schemas remain stable across adapters. A target adapter may omit a tool when its
capability is unsupported or the current user lacks permission.

The platform never registers an arbitrary API, query, code execution, SQL, DOM mutation, or free-form
navigation tool.

## 10. Initial agentic workflows

### 10.1 Clinic preparation

Prompt example:

> Prepare tomorrow's diabetes clinic. Show unresolved abnormal results, missing operational follow-up,
> and open tasks. Prepare the urgent follow-ups for review.

The agent lists a bounded appointment window, obtains chart briefs for those patients, identifies
recorded gaps, stages follow-up drafts, and opens one review queue. It does not diagnose or infer an
unrecorded clinical recommendation.

### 10.2 Focused patient review

The agent reads the active patient, summarizes recorded conditions/allergies/medications/vitals/results,
compares abnormal results with active follow-ups, and navigates the clinician to the native evidence.

### 10.3 LabLatch safety sweep

The agent finds abnormal results lacking active ownership, retrieves context, stages one or more
follow-up drafts, and opens the review queue. The clinician confirms each durable task individually or
uses a batch-confirm control that still displays every affected patient and action.

### 10.4 Overdue rescue

The agent lists overdue high-priority follow-ups, orders them by recorded priority and age, and opens the
native task workspace. Completion, cancellation, and reassignment remain human actions.

Population-health recall, referral management, order drafting, documentation drafting, billing,
inventory, and discharge-readiness packs are post-MVP additions that must reuse the same contracts and
safety classes.

## 11. OpenMRS adapter

The adapter is built against documented O3 and OpenMRS extension points:

- O3 route/session/privilege context and `openmrsFetch`.
- FHIR R4 `Observation` for laboratory results.
- REST concept retrieval for display names and reference metadata where FHIR responses are incomplete.
- Tasks module `CarePlan` endpoints for patient follow-up tasks.
- Provider and provider-role REST endpoints for assignee selection.
- Native O3 patient chart, Tests dashboard, and Task workspace for verification and confirmation.

The adapter must not import source code from upstream O3 repositories. It may reproduce documented
payload shapes as local types and use public endpoints.

OpenMRS Tasks currently persists task rationale but not a dedicated Observation reference. The adapter
therefore uses a versioned correlation codec in the rationale:

```text
Follow up recorded abnormal potassium result.
[emr-webmcp:v1 source=Observation/OBSERVATION_UUID workflow=lablatch]
```

The visible rationale remains clinically readable. The final marker provides deterministic correlation
and idempotency without changing the Tasks backend. Parsers accept only the exact final-line grammar;
arbitrary rationale text is never interpreted as metadata. Repeated confirmation for the same active
source reference returns a conflict rather than creating a duplicate task.

## 12. WebMCP lifecycle

The O3 module feature-detects `document.modelContext`. Absence of WebMCP leaves the ordinary application
fully functional and shows a non-blocking compatibility notice only inside the module's own page.

Each registration receives an `AbortSignal`. Registrations are replaced when the active user,
privileges, supported capabilities, or relevant route context changes. Page teardown aborts every
registration. Tool execution rechecks current authorization and route context; it never relies solely on
the state captured at registration time.

Schemas use `additionalProperties: false`, bounded strings, enumerated values, explicit date formats,
and hard maximum result counts. Returned collections use cursor pagination and set `meta.truncated`.

## 13. Human confirmation and clinical safety

The system uses four action classes:

1. **Read:** Retrieves bounded existing data.
2. **Navigate:** Opens a known native route or workspace.
3. **Draft:** Creates transient review state owned by the current browser session.
4. **Commit:** Writes durable EMR state and is never directly registered as a WebMCP tool in the MVP.

The review workspace displays patient identity, source evidence, proposed action, assignee, priority,
due date, and provenance. Confirmation is disabled when the patient or source result can no longer be
retrieved, the user lacks permission, or an active correlated task already exists.

The agent cannot:

- Edit or delete patients, encounters, observations, medications, orders, or results.
- Sign notes, prescribe, discharge, or communicate with a patient.
- Mark an item reviewed or completed without a visible native user action.
- Cross patients silently after a route change.
- Return an unbounded cohort or large chart payload to the agent.

## 14. Privacy, authorization, and audit

- All OpenMRS requests use the active browser session; no shared superuser token exists.
- The adapter respects server-side authorization errors and never treats hidden UI as authorization.
- Logs contain invocation IDs, tool names, duration, counts, adapter ID, and outcome only.
- Patient names, identifiers, observations, rationale, and tool arguments are excluded from application
  and reverse-proxy logs.
- Browser drafts expire after 30 minutes, logout, user change, or tab close.
- Demo credentials are scoped to synthetic data and stored only in deployment secrets.
- The public repository contains no credentials, host addresses, production data, or captured sessions.

## 15. Synthetic scale simulation

Simulation covers four independent dimensions.

### 15.1 Record scale

Synthea generates deterministic FHIR R4 patient histories. The importer maps supported Patients,
Encounters, Conditions, Allergies, Medications, Observations, Procedures, and CarePlans through normal
OpenMRS endpoints. Unsupported resources are reported, not silently dropped.

Profiles are:

- `smoke`: 25 patients for local tests.
- `demo`: 500 patients for deterministic browser demonstrations.
- `clinic`: 10,000 patients for the deployed scale demonstration.

Every profile has a fixed seed and a manifest containing generated/imported/rejected counts.

### 15.2 Operational backlog

A deterministic workload seeder creates synthetic appointments, tasks, and result-follow-up states:

- 500 appointments across a seven-day window.
- 2,000 follow-up tasks with open, completed, cancelled, and overdue cases.
- 1,000 laboratory Observations with configured normal, abnormal, and critical interpretations.
- 150 intentionally unlatched abnormal results.
- 100 duplicate/idempotency and stale-context edge cases.

These values are demonstration fixtures, not epidemiological claims.

### 15.3 Live activity

An event pump uses normal authenticated APIs to add synthetic results, appointments, and tasks at a
configurable rate. The deployed demo profile defaults to one event every two seconds and supports a
bounded 15-minute burst. The event pump never writes directly to the database.

### 15.4 Concurrent load

k6 profiles exercise read endpoints, the O3 gateway, and WebMCP-relevant API sequences at 1, 10, 25,
50, and 100 virtual users. Load tests target only synthetic environments and have explicit latency/error
thresholds. Browser-agent evaluations run separately so LLM latency is not confused with EMR capacity.

## 16. Evaluation

Twenty-five deterministic clinical-operations scenarios are executed in three modes:

1. Human-oriented UI path encoded as Playwright actions.
2. Browser actuation using ordinary UI controls without WebMCP.
3. Structured WebMCP tool path.

Each scenario records completion, elapsed time, number of interactions/tool calls, navigation count,
wrong-patient attempt, duplicate-action attempt, and unconfirmed-write attempt. A successful WebMCP run
must complete the requested preparation, preserve every confirmation gate, and make no unauthorized
write.

The hackathon report presents both successes and failures. It must not compare token counts unless all
three modes use equivalent model/session settings.

## 17. Testing strategy

- Unit tests validate schemas, pagination, correlation parsing, idempotency, lifecycle teardown, and
  privacy-safe telemetry.
- Adapter contract tests run against both `openmrs` and `contract-fixture` implementations.
- Mock Service Worker tests validate OpenMRS endpoint mappings and authorization failures.
- Component tests validate the review queue, stale-draft handling, and disabled confirmation states.
- Browser tests run against the full OpenMRS distribution and verify discovery, invocation, route
  changes, logout, and native confirmation.
- Load tests run against the deployed synthetic environment with thresholds stored in source.
- A repository secret scan and tracked-history scan run before any public remote is created.

## 18. Deployment on Crimson Prime

Crimson Prime has sufficient CPU, memory, disk, and a current Docker/Compose runtime. Existing OpenShip
edge services own host ports 80 and 443. EMR WebMCP therefore deploys as an isolated Compose project
whose gateway binds only to a loopback high port. OpenShip supplies the public HTTPS hostname,
certificate termination, and upstream route.

The deployment contains:

- Custom O3 frontend image with the EMR WebMCP module in its assembled import map.
- OpenMRS reference backend image with the Tasks and FHIR modules enabled.
- MariaDB with named volumes and generated secrets.
- OpenMRS gateway reachable only from the host loopback/OpenShip path.
- Optional synthetic event-pump profile disabled by default.
- Health checks for database, backend, frontend, gateway, module load, and WebMCP registration.

The public hostname is deployment configuration supplied through the existing OpenShip environment; it
is not committed to the repository. The deployment command fails if the hostname, generated database
passwords, or synthetic-data acknowledgement are absent.

The deployment is demonstration-grade, not authorized for real clinical use. A reset operation replaces
only this Compose project's synthetic volumes after producing a timestamped export manifest. It must not
address broad Docker, home, or filesystem paths.

## 19. Operational verification

A release is considered deployed only when all of the following pass against the public hostname:

1. HTTPS and certificate validation.
2. O3 login using the synthetic demo account.
3. Backend and FHIR health endpoints.
4. EMR WebMCP module present in the import map and routes registry.
5. Expected tools visible in Chrome's WebMCP debugging surface.
6. Clinic-preparation read flow returns bounded synthetic data.
7. LabLatch stages a draft without creating a Task.
8. User confirmation creates exactly one correlated Task.
9. Repeating confirmation is rejected as a duplicate.
10. Logout removes the registered tools and invalidates drafts.

## 20. Trade-offs and rejected approaches

### Generic arbitrary API tool

Rejected because it creates an over-privileged, prompt-injection-friendly control plane and discards the
semantic advantage of WebMCP.

### Forking OpenMRS or upstream O3 modules

Rejected because it raises maintenance cost and contradicts the portability thesis. A separately loaded
O3 module is sufficient.

### Reverse-proxy script injection for OpenMRS

Rejected for the reference implementation because O3 already has a supported module system. Proxy or
browser-extension installation remains a future adapter-host option for legacy systems.

### Custom result-review backend

Rejected for the MVP. OpenMRS Tasks provide a durable ownership lifecycle. The versioned correlation
marker closes the initial linkage gap without a new server module.

### Full second EMR implementation

Deferred. The contract-fixture adapter proves package boundaries and prevents OpenMRS types from leaking
into workflows. A real second adapter is the next proof point after the OpenMRS deployment.

### Agent-direct durable writes

Rejected for the MVP. Visible human confirmation is more defensible clinically and demonstrates useful
human-agent collaboration without overstating autonomy.

## 21. Acceptance criteria

- OpenMRS core and upstream O3 source remain unmodified.
- The core/workflow packages contain no OpenMRS imports.
- Both adapters pass the same contract suite.
- At least twelve WebMCP tools register conditionally from current capabilities and permissions.
- The three initial workflows run end-to-end on synthetic data.
- Draft tools make no network write to the EMR.
- Confirming a follow-up produces exactly one correlated OpenMRS Task.
- Unsupported, unauthorized, stale, duplicate, and offline paths return typed errors.
- Tool teardown occurs on logout, user change, and module unmount.
- The `clinic` profile imports 10,000 synthetic patients with an auditable manifest.
- k6 thresholds pass at the agreed 50-virtual-user demonstration profile; the 100-user profile is
  reported as a stress result rather than a release gate.
- No credentials, real patient data, host addresses, or PHI-bearing logs enter git history.
- The public Crimson Prime URL passes every operational verification check.
- The evaluation report includes reproducible commands and raw non-PHI metrics.

## 22. Implementation sequence

1. Establish monorepo tooling, canonical contracts, contract fixture, and safety policy.
2. Implement OpenMRS read/navigation capabilities and their contract tests.
3. Implement WebMCP registration and lifecycle management.
4. Build clinic-preparation and focused-review read flows.
5. Build the LabLatch draft/review/confirmation path with correlation and idempotency.
6. Assemble the custom OpenMRS distribution and deterministic synthetic demo profile.
7. Add browser scenarios, evaluation harness, and load profiles.
8. Deploy behind OpenShip on Crimson Prime and capture verification evidence.

Each phase must leave a runnable, independently testable deliverable. Application implementation is
routed through the Crimson factory using scoped tasks with explicit ownership and verification commands.
