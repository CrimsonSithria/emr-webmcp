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

The browser scenario suite writes allowlisted records to `artifacts/evaluation/raw/scenarios.json` and then aggregates them. A k6 run, when present, writes `artifacts/evaluation/raw/k6.json`. Collect both and write the lasting report once:

```bash
npx -y corepack@0.36.0 yarn test:browser
k6 run -e PROFILE=smoke -e VUS=10 -e BASE_URL="$BASE_URL" tests/load/k6/mixed-clinic.js
npx -y corepack@0.36.0 yarn evaluation:report
```

`yarn test:browser` already runs the aggregator after the scenario suite, so the last command is required only when you also have a k6 raw file to fold in.

The lasting files are `artifacts/evaluation/latest/summary.json` and `artifacts/evaluation/latest/summary.md`. They stay gitignored. Allowed fields are scenario ID, run ID, status, count, duration, percentile, HTTP class, tool name, and adapter ID. `count` is a metric, not a virtual-user field; only `status: stress-only` omits the 50-VU gate.

Unit tests under `simulation/src/report/` check redaction and the write path; they delete their own temporary directories and are not the reproduction command.
