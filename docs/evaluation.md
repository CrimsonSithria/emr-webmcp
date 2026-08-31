# Evaluation

Reproduce synthetic clinic evidence without PHI, credentials, or hostnames in the output.

Set `BASE_URL` to the loopback or private origin of a synthetic OpenMRS environment. Do not commit the value. Session cookies belong in `OPENMRS_SESSION` and must never be printed.

## Recreate the synthetic clinic

```bash
simulation/scripts/generate-synthea.sh smoke
simulation/scripts/import-profile.sh smoke
simulation/scripts/seed-workload.sh smoke
simulation/scripts/seed-workload.sh smoke
```

The second seed must create zero additional records. Demo and clinic profiles use the same scripts with `demo` or `clinic`.

## Browser scenarios

The 25 deterministic scenarios live in `tests/browser/scenarios/manifest.ts` and run against the Vite harness (no live distribution required for this phase).

```bash
npx -y corepack@0.36.0 yarn test:browser
```

Each `both` row must appear in `ui-scenarios.spec.ts` and `webmcp-scenarios.spec.ts`. `createFollowup` runs only after a visible confirm click.

## Load profiles

k6 profiles are 1, 10, 25, 50, and 100 virtual users.

```bash
k6 run -e PROFILE=smoke -e VUS=1 -e BASE_URL="$BASE_URL" tests/load/k6/read-tools.js
k6 run -e PROFILE=smoke -e VUS=10 -e BASE_URL="$BASE_URL" tests/load/k6/mixed-clinic.js
k6 run -e PROFILE=demo -e VUS=25 -e BASE_URL="$BASE_URL" tests/load/k6/mixed-clinic.js
k6 run -e PROFILE=demo -e VUS=50 -e BASE_URL="$BASE_URL" tests/load/k6/mixed-clinic.js
k6 run -e PROFILE=demo -e VUS=100 -e BASE_URL="$BASE_URL" tests/load/k6/stress.js
```

The 50-VU run is the release gate: HTTP error rate below 1%, bounded-read p95 below 1.5 seconds, and zero invariant failures. The 100-VU run is stress-only and must not gate a release.

Local smoke is 1 or 10 VUs. Reserve 50 and 100 VUs for Crimson Prime.

## Scrubbed report

```bash
npx -y corepack@0.36.0 yarn workspace @emr-webmcp/simulation test
```

Aggregation writes `artifacts/evaluation/summary.json` and `artifacts/evaluation/summary.md` at runtime only. Those files stay gitignored. Allowed fields are scenario ID, run ID, status, count, duration, percentile, HTTP class, tool name, and adapter ID.
