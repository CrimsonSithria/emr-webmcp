# EMR WebMCP Master Implementation Plan

> **Required subskill:** Use `superpowers:executing-plans` to execute each phase in order. Use `superpowers:test-driven-development` for every behavior change and `superpowers:verification-before-completion` before closing a phase.

**Goal:** Deliver a reusable WebMCP agent surface for existing web EMRs, prove it against an unmodified OpenMRS 3 distribution, and deploy the synthetic-data demonstration on Crimson Prime.

**Architecture:** An EMR-neutral TypeScript core owns canonical DTOs, safety policy, tool schemas, registration lifecycle, and workflows. Target adapters translate those contracts to the host EMR. The OpenMRS 3 adapter is an O3 frontend module using the active browser session and documented APIs. Agents may read, navigate, and stage transient drafts; durable clinical writes require explicit confirmation in a visible O3 workspace.

**Tech Stack:** Node.js 22, Yarn 4.10.3, TypeScript 5.9.3, Vitest 4.1.x, React 18, OpenMRS O3 10, Carbon, MSW, Playwright, Synthea, k6, Docker Compose, OpenShip.

**Spec:** `docs/superpowers/specs/2026-08-31-emr-webmcp-design.md`

**Global Constraints:** Do not modify or fork OpenMRS core or upstream O3 packages. Do not expose arbitrary API, DOM, SQL, code-execution, or durable-write tools. Do not log PHI or commit credentials, host addresses, real patient data, generated bulk datasets, or factory files. All application changes run through Crimson Factory. Every behavioral task follows red-green-refactor and includes an exact verification command.

## Phase order

| Phase | Plan | Runnable outcome | Gate |
|---|---|---|---|
| 1 | `2026-08-31-foundation-contracts.md` | EMR-neutral packages, fixture adapter, typed tool registry, lifecycle tests | Unit and contract suites pass |
| 2 | `2026-08-31-openmrs-adapter-o3.md` | O3 module with OpenMRS reads, navigation, and capability-aware tools | Mocked adapter and module suites pass |
| 3 | `2026-08-31-workflows-review-ui.md` | Clinic prep, focused review, LabLatch, transient drafts, human-confirmed Task creation | Browser safety scenarios pass |
| 4 | `2026-08-31-simulation-evaluation.md` | Deterministic synthetic clinic profiles, event pump, scenario runner, load reports | Demo profile and release thresholds pass |
| 5 | `2026-08-31-crimson-prime-deployment.md` | Isolated OpenMRS distribution behind OpenShip with operational evidence | Public HTTPS verification passes |

## Delivery discipline

1. Start each phase from the exact commit produced by the prior phase.
2. Give Crimson tasks disjoint ownership. Core/workflow tasks may not edit OpenMRS adapter files; deployment tasks may not alter clinical behavior.
3. Run the phase-specific verification matrix before accepting its factory branch.
4. Record only non-PHI evidence: command, commit SHA, duration, counts, status, and artifact checksum.
5. Do not deploy a phase that has not passed its local gate.

## Final acceptance command sequence

```bash
npx -y corepack@0.36.0 yarn install --immutable
npx -y corepack@0.36.0 yarn lint
npx -y corepack@0.36.0 yarn typecheck
npx -y corepack@0.36.0 yarn test
npx -y corepack@0.36.0 yarn test:contract
npx -y corepack@0.36.0 yarn test:browser
docker compose -f deploy/crimson-prime/compose.yml config --quiet
```

The live deployment additionally runs `deploy/crimson-prime/scripts/verify-live.sh` from Crimson Prime and stores the scrubbed JSON result under `artifacts/verification/`, which remains gitignored.
