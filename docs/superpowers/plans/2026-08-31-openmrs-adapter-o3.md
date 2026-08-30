# OpenMRS Adapter and O3 Module Implementation Plan

> **Required subskill:** Use `superpowers:executing-plans` to implement this plan task-by-task. Use `superpowers:test-driven-development` for all adapter and lifecycle behavior.

**Goal:** Implement the first real adapter as an OpenMRS 3 frontend module that reads and navigates through documented O3/OpenMRS interfaces while preserving the active browser session and authorization boundary.

**Architecture:** `@emr-webmcp/openmrs-adapter` owns transport payload types and translation into canonical DTOs. `@emr-webmcp/openmrs-esm` owns O3 session/route integration and passes a narrow port into the adapter. The O3 module registers only tools supported by the current server capabilities and user privileges.

**Tech Stack:** Official `@openmrs/create-o3-app` 1.2.0 scaffold, O3 10 next line, Rspack, React 18, Carbon 1.x, SWR 2, MSW 2.15.0, Vitest 4.1.x.

**Spec:** `docs/superpowers/specs/2026-08-31-emr-webmcp-design.md` sections 9, 11-14, and 21.

**Global Constraints:** Do not copy or modify upstream source. Use `openmrsFetch` and documented routes only. The adapter exports canonical DTOs, never raw FHIR/REST payloads. All calls use the current O3 session. Hidden UI is not authorization. No durable write is registered with `document.modelContext`.

## Task 1: Scaffold the O3 module and adapter package

**Files:**
- Create: `apps/openmrs-esm/**` from the official generator
- Create: `packages/adapters/openmrs/package.json`
- Create: `packages/adapters/openmrs/tsconfig.json`
- Create: `packages/adapters/openmrs/src/index.ts`
- Modify: `package.json`

**Steps:**
1. Generate into a temporary directory with `npm create @openmrs/o3-app@1.2.0 -- openmrs-esm --standalone --package-name @emr-webmcp/openmrs-esm --route /emr-webmcp --route-component EmrWebmcp --no-git`, then copy only generated module files into `apps/openmrs-esm`. Preserve the repository README and root configuration.
2. Retain Rspack, Vitest, Carbon, and the generator's O3 peer dependencies. Change generated repository metadata to this repository and set `private: true` until release packaging exists.
3. Add `@emr-webmcp/core` and `@emr-webmcp/openmrs-adapter` as workspace dependencies. Add MSW 2.15.0 for transport tests.
4. Replace the generated greeting assertion with a failing shell test that expects an `EmrWebmcpShell` receiving adapter/session ports; do not add product behavior yet.
5. Implement the minimal shell and verify `yarn workspace @emr-webmcp/openmrs-esm test`, build, and typecheck.
6. Commit: `build(openmrs): scaffold o3 frontend module`.

## Task 2: Implement read-side OpenMRS transport and mappings

**Files:**
- Create: `packages/adapters/openmrs/src/transport/openmrs-client.ts`
- Create: `packages/adapters/openmrs/src/transport/fhir-types.ts`
- Create: `packages/adapters/openmrs/src/transport/rest-types.ts`
- Create: `packages/adapters/openmrs/src/mappers/patient.ts`
- Create: `packages/adapters/openmrs/src/mappers/appointment.ts`
- Create: `packages/adapters/openmrs/src/mappers/result.ts`
- Create: `packages/adapters/openmrs/src/mappers/followup.ts`
- Create: `packages/adapters/openmrs/src/openmrs-adapter.ts`
- Test: `packages/adapters/openmrs/src/openmrs-adapter.test.ts`
- Test: `tests/contract/src/openmrs-adapter.contract.test.ts`

**Steps:**
1. Write MSW-backed failing tests for patient search, active-patient lookup, appointments, chart brief aggregation, FHIR laboratory Observations, one result, CarePlan tasks, provider/role assignees, 401/403 mapping, 404 mapping, pagination, and abort propagation.
2. Add the OpenMRS adapter to the shared contract suite using deterministic MSW fixtures and verify it fails before implementation.
3. Implement the narrow client around injected `openmrsFetch`. Use `/ws/fhir2/R4/Observation` with `patient` and `category=laboratory`, `/ws/rest/v1/tasks/careplan` for follow-ups, and documented patient/provider/appointment endpoints. Centralize URLs; do not scatter endpoint strings.
4. Normalize FHIR `interpretation` and reference ranges to `ResultSummary`. Unrecognized codes map to `unknown`; they never default to abnormal or normal.
5. Bound remote page sizes and locally enforce canonical limits. Map server errors to domain errors without including response bodies.
6. Run adapter unit tests and both adapter contract suites.
7. Commit: `feat(openmrs): implement canonical read adapter`.

## Task 3: Connect O3 session, routes, permissions, and WebMCP

**Files:**
- Create: `apps/openmrs-esm/src/openmrs/adapter-factory.ts`
- Create: `apps/openmrs-esm/src/openmrs/capability-probe.ts`
- Create: `apps/openmrs-esm/src/openmrs/navigation.ts`
- Create: `apps/openmrs-esm/src/webmcp/document-model-context.ts`
- Create: `apps/openmrs-esm/src/webmcp/use-webmcp-registration.ts`
- Create: `apps/openmrs-esm/src/webmcp/use-webmcp-registration.test.tsx`
- Modify: `apps/openmrs-esm/src/emr-webmcp.component.tsx`
- Modify: `apps/openmrs-esm/src/routes.json`

**Steps:**
1. Write failing component tests proving: no crash without `document.modelContext`; twelve eligible tools register with complete privileges/capabilities; unsupported tools are omitted; logout, user change, privilege change, route-context change, and unmount abort prior registrations.
2. Write navigation tests for known patient chart, Tests, Tasks, and review routes. Reject unknown targets and encode only path parameters, never full arbitrary URLs.
3. Implement a typed `DocumentModelContext` adapter around `document.modelContext.registerTool`. Add the ambient WebMCP declaration locally because the browser API is experimental.
4. Build the OpenMRS adapter from active O3 session and route hooks. Recheck session and privileges inside every handler, not only during registration.
5. Display a non-blocking compatibility notice inside `/emr-webmcp` when WebMCP is absent; the ordinary module remains functional.
6. Run module tests, typecheck, and a production Rspack build.
7. Commit: `feat(openmrs): expose safe tools in o3 session`.

## Phase verification

```bash
npx -y corepack@0.36.0 yarn workspace @emr-webmcp/openmrs-adapter test
npx -y corepack@0.36.0 yarn test:contract
npx -y corepack@0.36.0 yarn workspace @emr-webmcp/openmrs-esm test
npx -y corepack@0.36.0 yarn workspace @emr-webmcp/openmrs-esm build
npx -y corepack@0.36.0 yarn typecheck
git diff --check
```

Expected outcome: OpenMRS is the second adapter passing the shared contract, and its O3 module can register safe tools without any OpenMRS fork or server patch.
