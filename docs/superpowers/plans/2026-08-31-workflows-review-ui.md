# Workflows and Human Review UI Implementation Plan

> **Required subskill:** Use `superpowers:executing-plans` to implement this plan task-by-task. Use `superpowers:test-driven-development` and preserve the explicit human confirmation boundary.

**Goal:** Implement clinic preparation, focused review, LabLatch safety sweep, overdue rescue, and the visible review workspace that alone may create a durable OpenMRS Task.

**Architecture:** Workflow packages compose only `EmrAdapter`; they cannot import OpenMRS. A session-scoped `DraftStore` holds validated proposals for 30 minutes and emits no network writes. The O3 review workspace resolves each draft against current server state, then calls `createFollowup` only from a human click after all safety checks pass.

**Tech Stack:** TypeScript, Vitest, React 18, Carbon, Testing Library, Playwright, OpenMRS CarePlan Tasks.

**Spec:** `docs/superpowers/specs/2026-08-31-emr-webmcp-design.md` sections 10, 11, 13-17, and 21.

**Global Constraints:** Workflows use only `EmrAdapter`. Draft creation makes zero write requests. Durable confirmation is never a WebMCP tool. Confirmation is disabled for stale source evidence, patient mismatch, lost privilege, duplicate active correlation, or offline state. Drafts expire on 30 minutes, logout, user change, and tab close.

## Task 1: Build pure workflow orchestration

**Files:**
- Create: `packages/workflows/clinic-prep/package.json`
- Create: `packages/workflows/clinic-prep/src/prepare-clinic.ts`
- Test: `packages/workflows/clinic-prep/src/prepare-clinic.test.ts`
- Create: `packages/workflows/coordination/package.json`
- Create: `packages/workflows/coordination/src/focused-review.ts`
- Create: `packages/workflows/coordination/src/overdue-rescue.ts`
- Test: `packages/workflows/coordination/src/coordination.test.ts`
- Create: `packages/workflows/lablatch/package.json`
- Create: `packages/workflows/lablatch/src/find-unlatched.ts`
- Test: `packages/workflows/lablatch/src/find-unlatched.test.ts`

**Steps:**
1. Write failing tests against the fixture adapter for the four workflows. Cover empty clinics, seven-day bound violations, patient mismatch, result caps, active/completed/cancelled correlated tasks, overdue calculation at an injected clock, and partial upstream failure.
2. Implement clinic prep as bounded appointment lookup plus per-patient briefs with a configurable concurrency ceiling of five. Preserve stable appointment order.
3. Implement focused review for exactly one patient and overdue rescue with explicit filters; no implicit cross-patient aggregation.
4. Implement LabLatch by joining abnormal results to active follow-ups by exact `sourceReference`, returning at most 100 items and truthful truncation metadata.
5. Run every workflow test with both fixture and OpenMRS contract fixtures where applicable.
6. Commit: `feat(workflows): compose bounded clinical flows`.

## Task 2: Implement transient drafts and correlation codec

**Files:**
- Create: `packages/core/src/drafts/draft-store.ts`
- Test: `packages/core/src/drafts/draft-store.test.ts`
- Create: `packages/workflows/lablatch/src/correlation-codec.ts`
- Test: `packages/workflows/lablatch/src/correlation-codec.test.ts`
- Modify: `packages/adapters/openmrs/src/mappers/followup.ts`
- Modify: `packages/adapters/openmrs/src/openmrs-adapter.ts`
- Test: `packages/adapters/openmrs/src/create-followup.test.ts`

**Steps:**
1. Write failing `DraftStore` tests for input validation, session ownership, 30-minute expiry, logout/user-change clearing, explicit consume, and redacted diagnostics. Assert staging invokes no adapter method.
2. Write failing codec tests for exact final-line grammar `[emr-webmcp:v1 source=Observation/UUID workflow=lablatch]`, round trip, embedded marker rejection, malformed source rejection, and preservation of readable rationale.
3. Write failing OpenMRS confirmation tests proving a preflight query occurs, an active duplicate returns conflict with no POST, and a valid request posts exactly one CarePlan to `/ws/rest/v1/tasks/careplan`.
4. Implement the in-memory draft store with injected clock and random UUID. Never use `localStorage`, IndexedDB, or a server draft endpoint.
5. Implement exact codec parsing and serialization. Only the final line is metadata; preceding rationale is opaque text.
6. Implement `createFollowup` with current-user privilege recheck, patient/source re-fetch, duplicate preflight, and one POST. Map repeated server conflict to the canonical conflict error.
7. Run focused tests plus the shared contract suite.
8. Commit: `feat(lablatch): stage and correlate safe followups`.

## Task 3: Build and prove the review workspace

**Files:**
- Create: `apps/openmrs-esm/src/review/review-queue.component.tsx`
- Create: `apps/openmrs-esm/src/review/review-item.component.tsx`
- Create: `apps/openmrs-esm/src/review/confirmation-controller.ts`
- Test: `apps/openmrs-esm/src/review/review-queue.test.tsx`
- Modify: `apps/openmrs-esm/src/routes.json`
- Modify: `apps/openmrs-esm/src/index.ts`
- Create: `tests/browser/playwright.config.ts`
- Create: `tests/browser/fixtures/model-context.ts`
- Create: `tests/browser/specs/draft-confirmation.spec.ts`
- Create: `tests/browser/specs/registration-lifecycle.spec.ts`

**Steps:**
1. Write failing component tests showing patient identity, source evidence, proposed title/rationale, assignee, priority, due date, and agent provenance. Assert button-disabled reasons for all five unsafe conditions.
2. Implement confirmation as a state machine: `idle -> validating -> ready -> committing -> succeeded|failed`. Ignore double clicks while committing and consume the draft only after a successful response.
3. Add the review route and tool navigation target. `stage_followup_task` stores a draft and returns its ID; `open_review_queue` only navigates.
4. Write Playwright scenarios that instrument network requests. Assert staging performs zero POST/PUT/PATCH/DELETE requests; a visible click performs exactly one POST; duplicate confirmation cannot create a second task.
5. Add lifecycle browser coverage for registration, logout, route change, user change, and unmount using a fake `document.modelContext` bridge.
6. Run component tests and browser scenarios.
7. Commit: `feat(openmrs): add human-gated review workspace`.

## Phase verification

```bash
npx -y corepack@0.36.0 yarn test
npx -y corepack@0.36.0 yarn test:contract
npx -y corepack@0.36.0 yarn test:browser --grep 'draft|confirmation|lifecycle'
npx -y corepack@0.36.0 yarn typecheck
git grep -n 'createFollowup' -- packages/core packages/workflows && exit 1 || true
```

Expected outcome: agents can complete all read/navigation/draft work, while one visible, current-user O3 action remains the only route to a durable task.
