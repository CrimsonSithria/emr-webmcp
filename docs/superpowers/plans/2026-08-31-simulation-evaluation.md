# Simulation and Evaluation Implementation Plan

> **Required subskill:** Use `superpowers:executing-plans` to implement this plan task-by-task. Use `superpowers:test-driven-development` for deterministic seed logic and evaluators.

**Goal:** Create reproducible synthetic patient populations, operational backlog, live activity, browser scenarios, and load tests that demonstrate realistic clinic-scale agent work without PHI.

**Architecture:** Synthea generates baseline FHIR bundles outside the application. A versioned importer manifest and idempotent workload seeder create appointments, laboratory Observations, and CarePlan tasks through OpenMRS APIs. A separate event pump adds bounded activity. Evaluators record only synthetic IDs, counts, latency, correctness, and safety outcomes.

**Tech Stack:** Synthea, Node.js 22 scripts, TypeScript, Vitest, Playwright, k6, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-08-31-emr-webmcp-design.md` sections 15-17 and 21.

**Global Constraints:** Generated bulk data and runtime reports are gitignored. Every record is synthetic and tagged with a run ID. Seeders are deterministic and idempotent. Evaluation output contains no names, identifiers, clinical values, draft rationale, cookies, or credentials.

## Task 1: Define deterministic profiles and manifests

**Files:**
- Create: `simulation/profiles/smoke.json`
- Create: `simulation/profiles/demo.json`
- Create: `simulation/profiles/clinic.json`
- Create: `simulation/src/profile-schema.ts`
- Create: `simulation/src/manifest.ts`
- Create: `simulation/src/profile-schema.test.ts`
- Create: `simulation/scripts/generate-synthea.sh`
- Modify: `.gitignore`
- Modify: `package.json`

**Steps:**
1. Write failing schema tests for exact profile counts: smoke 25, demo 500, clinic 10,000. Reject negative counts, unknown fields, mutable random seeds, and output paths outside `artifacts/simulation/`.
2. Define each profile with pinned Synthea image/release, seed, population count, run ID prefix, and FHIR R4 output.
3. Implement a wrapper that runs Synthea in a container, hashes the profile and output manifest, and refuses to overwrite a different completed run. The script must not commit generated bundles.
4. Emit `manifest.json` with generator version, seed, counts, timestamps, file checksums, and synthetic-data attestation.
5. Run schema tests and generate the smoke profile twice; verify identical logical counts and a no-op second run.
6. Commit: `feat(simulation): define deterministic patient profiles`.

## Task 2: Seed operational backlog and live events

**Files:**
- Create: `simulation/src/openmrs-admin-client.ts`
- Create: `simulation/src/workload-plan.ts`
- Create: `simulation/src/workload-seeder.ts`
- Test: `simulation/src/workload-seeder.test.ts`
- Create: `simulation/src/event-pump.ts`
- Test: `simulation/src/event-pump.test.ts`
- Create: `simulation/scripts/import-profile.sh`
- Create: `simulation/scripts/seed-workload.sh`

**Steps:**
1. Write failing tests for a deterministic clinic plan containing 500 appointments, 2,000 follow-up tasks, 1,000 lab Observations, 150 unlatched abnormal results, and 100 edge cases. Assert patient references always belong to the imported manifest.
2. Implement idempotency keys as `emr-webmcp:<runId>:<recordKind>:<ordinal>` stored in supported identifiers or exact correlation rationale. Re-running a seed must create zero duplicates.
3. Use an injected admin client in tests and environment-only credentials in scripts. Never print auth headers or response bodies.
4. Implement an event pump defaulting to one synthetic event every two seconds for 15 minutes, with SIGINT/SIGTERM shutdown and a `--dry-run` mode.
5. Run the smoke import, seed it twice, and compare counts. Run the event pump with fake timers in unit tests.
6. Commit: `feat(simulation): seed clinic workload and activity`.

## Task 3: Add scenario and load evaluation

**Files:**
- Create: `tests/browser/scenarios/manifest.ts`
- Create: `tests/browser/scenarios/webmcp-scenarios.spec.ts`
- Create: `tests/browser/scenarios/ui-scenarios.spec.ts`
- Create: `tests/load/k6/common.js`
- Create: `tests/load/k6/read-tools.js`
- Create: `tests/load/k6/mixed-clinic.js`
- Create: `tests/load/k6/stress.js`
- Create: `simulation/src/report/redact.ts`
- Create: `simulation/src/report/aggregate.ts`
- Test: `simulation/src/report/redact.test.ts`
- Create: `docs/evaluation.md`

**Steps:**
1. Encode the 25 deterministic scenarios from the spec as a manifest with expected result, safety class, and execution surface. Fail if any scenario lacks UI and/or WebMCP coverage required by its class.
2. Implement Playwright scenario runners for successful reads, unsupported capability, unauthorized, stale draft, duplicate correlation, offline, logout teardown, route changes, empty clinic, large clinic, abnormal-result edge cases, and human confirmation.
3. Implement k6 profiles at 1, 10, 25, 50, and 100 virtual users. Gate 50 VUs on error rate below 1%, p95 bounded-read latency below 1.5 seconds, and no invariant failure. Record 100 VUs as stress-only.
4. Write failing redaction tests with synthetic PHI-like fixtures, then implement a report allowlist containing scenario ID, run ID, status, count, duration, percentile, HTTP class, tool name, and adapter ID only.
5. Aggregate raw results into `artifacts/evaluation/summary.json` and a Markdown table. Document exact reproduction commands in `docs/evaluation.md`.
6. Run smoke browser scenarios and a short 1/10-VU k6 check locally; reserve the 50/100-VU run for Crimson Prime.
7. Commit: `test: add synthetic safety and load evaluation`.

## Phase verification

```bash
npx -y corepack@0.36.0 yarn workspace @emr-webmcp/simulation test
npx -y corepack@0.36.0 yarn test:browser
simulation/scripts/generate-synthea.sh smoke
simulation/scripts/import-profile.sh smoke
simulation/scripts/seed-workload.sh smoke
simulation/scripts/seed-workload.sh smoke
k6 run -e PROFILE=smoke -e VUS=10 tests/load/k6/mixed-clinic.js
git status --short --ignored | rg 'artifacts/simulation|artifacts/evaluation'
```

Expected outcome: a fresh environment can recreate the same synthetic clinic and produce scrubbed correctness, safety, latency, and load evidence.
