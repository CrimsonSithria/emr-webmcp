# Crimson Prime Deployment Implementation Plan

> **Required subskill:** Use `superpowers:executing-plans` for repository changes and `superpowers:verification-before-completion` for the live deployment. Treat deployment as an operational change with rollback.

**Goal:** Assemble and deploy an isolated OpenMRS 3 reference distribution on Crimson Prime behind the existing OpenShip edge, load the synthetic demo profile, and capture non-PHI verification evidence.

**Architecture:** Docker Compose runs a pinned OpenMRS backend, MariaDB, custom O3 frontend/import map, gateway, and optional event pump on an internal network. Only the gateway binds to a loopback high port. OpenShip owns public ports 80/443 and routes one dedicated hostname to that loopback upstream. Persistent volumes hold database state; repository configuration contains no secrets or host-specific addresses.

**Tech Stack:** Docker 29+, Compose 5+, pinned OpenMRS reference application images, MariaDB, Nginx gateway, OpenShip, Bash health checks, k6.

**Spec:** `docs/superpowers/specs/2026-08-31-emr-webmcp-design.md` sections 18-21.

**Global Constraints:** Never bind this stack to host ports 80 or 443. Never alter unrelated OpenShip routes or other Crimson Prime stacks. All image tags and digests are pinned. Secrets live in VPS-only environment files with mode 0600. Deployment uses synthetic data only. Back up Compose state before upgrades and provide a tested rollback command.

## Task 1: Assemble a reproducible custom distribution

**Files:**
- Create: `distribution/openmrs/spa-assemble-config.json`
- Create: `distribution/openmrs/frontend.Dockerfile`
- Create: `distribution/openmrs/gateway.conf`
- Create: `distribution/openmrs/verify-import-map.mjs`
- Test: `distribution/openmrs/verify-import-map.test.ts`
- Create: `deploy/crimson-prime/compose.yml`
- Create: `deploy/crimson-prime/.env.example`
- Create: `deploy/crimson-prime/README.md`

**Steps:**
1. Write a failing import-map test requiring the built `@emr-webmcp/openmrs-esm` artifact alongside the pinned O3 reference modules and Tasks package.
2. Build the module, assemble the O3 frontend in a multi-stage image, and verify its import map before the image is emitted.
3. Define Compose services `db`, `backend`, `frontend`, `gateway`, and profile-gated `event-pump`. Add health checks, restart policies, resource limits, named volumes, and an isolated network.
4. Bind only `${EMR_WEBMCP_BIND_ADDRESS:-127.0.0.1}:${EMR_WEBMCP_PORT:-18080}` on the gateway. Do not include a real hostname, password, VPS address, or public IP.
5. Pin every external image by immutable digest and document the command used to refresh each digest.
6. Run `docker compose -f deploy/crimson-prime/compose.yml --env-file deploy/crimson-prime/.env.example config --quiet` and container image builds.
7. Commit: `build(deploy): assemble openmrs reference stack`.

## Task 2: Add safe deployment, backup, rollback, and verification scripts

**Files:**
- Create: `deploy/crimson-prime/scripts/preflight.sh`
- Create: `deploy/crimson-prime/scripts/backup.sh`
- Create: `deploy/crimson-prime/scripts/deploy.sh`
- Create: `deploy/crimson-prime/scripts/rollback.sh`
- Create: `deploy/crimson-prime/scripts/verify-live.sh`
- Create: `deploy/crimson-prime/scripts/lib.sh`
- Test: `deploy/crimson-prime/tests/scripts.bats`
- Modify: `.gitignore`

**Steps:**
1. Write failing Bats tests using stubbed `docker`, `curl`, and `openssl` commands. Cover missing secrets, occupied port, unhealthy dependency, backup failure, deploy timeout, rollback, redacted output, and cleanup.
2. Implement preflight checks for Docker/Compose versions, loopback port availability, disk headroom, required secret variables, file mode 0600, and absence of real PHI attestations.
3. Implement a timestamped MariaDB logical backup plus Compose/config/image manifest under a VPS-only backup directory. Abort deployment if backup fails.
4. Implement pull/build/up with bounded health waits. Preserve the previous image manifest and make rollback restore it plus the prior Compose project state; database restore remains an explicit separate command.
5. Implement live verification for HTTPS, login page, authenticated synthetic login, FHIR capability, module import map, WebMCP discovery, zero-write staging, exactly-one confirmation write, duplicate conflict, and logout teardown. Output allowlisted JSON only.
6. Run Bats tests, ShellCheck, Compose config validation, and local container smoke tests.
7. Commit: `ops: add reversible crimson prime deployment`.

## Task 3: Deploy and verify on Crimson Prime

**Live paths:**
- Stack root: `/srv/emr-webmcp`
- Secrets: `/srv/emr-webmcp/.env` mode 0600
- Backups: `/srv/emr-webmcp/backups`
- Verification artifacts: `/srv/emr-webmcp/artifacts/verification`

**Steps:**
1. On Crimson Prime, record current OpenShip container/image, route configuration checksum, listeners on 80/443 and the selected loopback port, disk availability, and running Compose projects. Do not print secrets.
2. Create `/srv/emr-webmcp`, transfer the exact verified repository commit, create the VPS-only `.env`, and run `scripts/preflight.sh`.
3. Run `scripts/deploy.sh`; wait for every container health check. Import the `demo` synthetic profile and seed workload.
4. Add one dedicated OpenShip hostname route to `127.0.0.1:18080` using the platform's supported configuration mechanism. Validate the OpenShip config before reload and verify unrelated routes still return their prior status.
5. Run `scripts/verify-live.sh` and the full 25-scenario browser suite against the public HTTPS origin.
6. Run k6 at 1, 10, 25, and 50 VUs as release gates, then 100 VUs as stress-only. Save scrubbed raw output and aggregate report outside git.
7. Restart the Compose project once and verify persistence, import map, Task correlation, and route health. Exercise `rollback.sh --dry-run` and record its resolved target.
8. Record deployed git SHA, pinned image digests, OpenShip route checksum, verification summary, and rollback target. Do not record host addresses or credentials in git.

## Phase verification

```bash
docker compose -f deploy/crimson-prime/compose.yml config --quiet
deploy/crimson-prime/scripts/preflight.sh
deploy/crimson-prime/scripts/verify-live.sh
npx -y corepack@0.36.0 yarn test:browser
k6 run -e PROFILE=demo -e VUS=50 tests/load/k6/mixed-clinic.js
k6 run -e PROFILE=demo -e VUS=100 tests/load/k6/stress.js
```

Expected outcome: the public synthetic OpenMRS instance demonstrates safe WebMCP workflows, survives restart, leaves existing VPS workloads unchanged, and has an explicit rollback target.
