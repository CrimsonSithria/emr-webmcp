# Foundation and Contracts Implementation Plan

> **Required subskill:** Use `superpowers:executing-plans` to implement this plan task-by-task. Use `superpowers:test-driven-development` for Tasks 2-4.

**Goal:** Establish a reproducible TypeScript monorepo containing the EMR-neutral contract, contract fixture, safety policy, WebMCP schemas, and registration lifecycle.

**Architecture:** `@emr-webmcp/core` contains only portable types and browser-neutral services. `@emr-webmcp/contract-fixture` is an in-memory adapter used to prove every adapter can satisfy the same behavioral suite. Browser-native registration is hidden behind a small `ModelContext` port so lifecycle behavior is deterministic under Vitest.

**Tech Stack:** Node.js 22, Yarn 4.10.3 through Corepack 0.36.0, TypeScript 5.9.3, Zod 4.5.4, Vitest 4.1.11, ESLint 10.0.2, Prettier 3.9.6.

**Spec:** `docs/superpowers/specs/2026-08-31-emr-webmcp-design.md` sections 6-9, 12-14, and 21.

**Global Constraints:** No OpenMRS imports in this phase. No production behavior before its failing test. Public DTOs are serializable and contain no raw upstream payload. Schemas reject unknown fields and enforce bounds. Tool errors never include stack traces, response bodies, credentials, or unrelated patient data.

## Task 1: Bootstrap the workspace without application behavior

**Files:**
- Modify: `package.json`
- Create: `.yarnrc.yml`
- Create: `tsconfig.base.json`
- Create: `eslint.config.mjs`
- Create: `prettier.config.mjs`
- Create: `vitest.workspace.ts`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`
- Create: `packages/adapters/contract-fixture/package.json`
- Create: `packages/adapters/contract-fixture/tsconfig.json`
- Create: `packages/adapters/contract-fixture/src/index.ts`

**Steps:**
1. Set root `packageManager` to `yarn@4.10.3`, `engines.node` to `>=22 <23`, and workspaces to `apps/*`, `packages/core`, `packages/adapters/*`, and `packages/workflows/*`.
2. Add root scripts `build`, `lint`, `typecheck`, `test`, and `test:contract` using `yarn workspaces foreach --all --topological-dev` and Vitest. Do not add Turborepo; Yarn workspaces are sufficient for this repository size.
3. Pin root development dependencies exactly to TypeScript 5.9.3, Vitest 4.1.11, ESLint 10.0.2, Prettier 3.9.6, and `@vitest/coverage-v8` 4.1.11. Add Zod 4.5.4 to `@emr-webmcp/core`.
4. Configure strict TypeScript with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `verbatimModuleSyntax`. Configure ESLint to reject `any` and floating promises in production sources.
5. Run `npx -y corepack@0.36.0 yarn install` to create `yarn.lock`, then run `npx -y corepack@0.36.0 yarn install --immutable`.
6. Run `npx -y corepack@0.36.0 yarn typecheck && npx -y corepack@0.36.0 yarn lint`.
7. Commit: `build: bootstrap typed monorepo`.

## Task 2: Define canonical DTOs and error envelopes

**Files:**
- Create: `packages/core/src/contracts/dtos.ts`
- Create: `packages/core/src/contracts/queries.ts`
- Create: `packages/core/src/contracts/adapter.ts`
- Create: `packages/core/src/contracts/tool-result.ts`
- Create: `packages/core/src/contracts/capabilities.ts`
- Test: `packages/core/src/contracts/contracts.test.ts`
- Modify: `packages/core/src/index.ts`

**Steps:**
1. Write failing compile-time and runtime tests covering every DTO and union in spec section 7, the complete `EmrAdapter` interface, and all six error codes from section 8. Assert `ToolResult` JSON serialization omits no required `meta` field.
2. Run `npx -y corepack@0.36.0 yarn workspace @emr-webmcp/core test --run contracts.test.ts`; verify failure because the modules do not exist.
3. Implement `PatientRef`, `AppointmentSummary`, `ResultSummary`, `FollowupSummary`, `FollowupDraft`, `ChartBrief`, `AssigneeSummary`, `ConfirmedFollowup`, the bounded query types, `EmrNavigationTarget`, `EmrCapability`, `EmrAdapter`, and `ToolResult<T>` exactly as the spec requires.
4. Add `successResult` and `errorResult` factories. Generate invocation IDs with injected `randomUUID` and timestamps with injected `now` so tests are deterministic. Ensure `errorResult` accepts only sanitized public messages.
5. Re-run the focused test, then `yarn workspace @emr-webmcp/core typecheck`.
6. Commit: `feat(core): define emr adapter contract`.

## Task 3: Add the fixture adapter and shared contract suite

**Files:**
- Create: `packages/adapters/contract-fixture/src/fixture-data.ts`
- Create: `packages/adapters/contract-fixture/src/fixture-adapter.ts`
- Create: `tests/contract/package.json`
- Create: `tests/contract/tsconfig.json`
- Create: `tests/contract/src/adapter-contract.ts`
- Create: `tests/contract/src/fixture-adapter.contract.test.ts`
- Modify: `package.json`

**Steps:**
1. Write a reusable `describeAdapterContract(makeAdapter)` suite that fails until an adapter proves capability reporting, patient search limits, seven-day appointment bounds, abnormal-result filtering, follow-up filtering, duplicate-source conflict behavior, navigation validation, and typed not-found/invalid-input errors.
2. Run `npx -y corepack@0.36.0 yarn workspace @emr-webmcp/contract-tests test`; verify missing fixture behavior fails.
3. Implement a deterministic in-memory adapter with twelve patients, appointments, observations, assignees, and tasks. Keep mutation inside each test instance and expose recorded navigation targets for assertions.
4. Make duplicate `createFollowup` calls for the same active `sourceReference` throw a typed conflict; completed or cancelled tasks do not block a new follow-up.
5. Re-run the contract suite twice to prove isolation and determinism.
6. Commit: `test: establish adapter contract suite`.

## Task 4: Implement schemas, safety policy, and registration lifecycle

**Files:**
- Create: `packages/core/src/tools/tool-definitions.ts`
- Create: `packages/core/src/tools/tool-schemas.ts`
- Create: `packages/core/src/tools/tool-policy.ts`
- Create: `packages/core/src/tools/tool-registry.ts`
- Create: `packages/core/src/tools/tool-registry.test.ts`
- Create: `packages/core/src/tools/model-context.ts`
- Create: `packages/core/src/tools/registration-manager.ts`
- Create: `packages/core/src/tools/registration-manager.test.ts`
- Modify: `packages/core/src/index.ts`

**Steps:**
1. Write failing table-driven tests for all twelve tool names in spec section 9. Verify each schema has `additionalProperties: false`, bounded strings, hard collection limits, date-time formats, and the correct Read, Navigate, or Draft safety class. Assert no Commit tool exists.
2. Write lifecycle tests with a fake `ModelContext`: initial registration, capability omission, privilege omission, replacement on context fingerprint change, execution-time authorization recheck, logout abort, user-change abort, and unmount abort.
3. Run the two focused test files and verify failures.
4. Implement immutable tool definitions, schemas, a pure policy selector, and `RegistrationManager`. Each registration uses a child `AbortController`; replacing context aborts all old signals before registering the new set.
5. Make tool execution validate input before calling a handler and convert known domain failures to `ToolResult`; unexpected errors become sanitized `upstream` results.
6. Run `yarn workspace @emr-webmcp/core test`, `yarn test:contract`, `yarn typecheck`, and `yarn lint`.
7. Commit: `feat(core): register bounded capability-aware tools`.

## Phase verification

```bash
npx -y corepack@0.36.0 yarn install --immutable
npx -y corepack@0.36.0 yarn lint
npx -y corepack@0.36.0 yarn typecheck
npx -y corepack@0.36.0 yarn test
npx -y corepack@0.36.0 yarn test:contract
git grep -nE '@openmrs|openmrsFetch' -- packages/core packages/adapters/contract-fixture tests/contract && exit 1 || true
```

Expected outcome: the fixture is the first passing adapter, twelve safe tool definitions exist, and lifecycle teardown is proven without needing a browser or OpenMRS.
