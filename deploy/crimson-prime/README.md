# Crimson Prime Compose stack

Isolated OpenMRS 3 reference distribution for EMR WebMCP. OpenShip owns host
ports 80/443. This stack publishes only the gateway on a loopback high port.

Default bind: `127.0.0.1:18080` via
`${EMR_WEBMCP_BIND_ADDRESS:-127.0.0.1}:${EMR_WEBMCP_PORT:-18080}`.

Do not bind 80 or 443. Do not put a real hostname, password, VPS address, or
public IP in files that are committed.

## Services

| Service | Role |
|---|---|
| `db` | MariaDB 10.11.7 (digest-pinned) |
| `backend` | Official OpenMRS 3 reference backend (`qa`, digest-pinned) |
| `frontend` | Custom O3 SPA built from `distribution/openmrs/frontend.Dockerfile` |
| `gateway` | Official reference gateway with `distribution/openmrs/gateway.conf` |
| `event-pump` | Compose profile `event-pump` — disabled by default |

Enable the synthetic event pump with `--profile event-pump`. It is stdout-only
and does not write to OpenMRS APIs.

## Validate compose (no daemon required for config)

```bash
docker compose -f deploy/crimson-prime/compose.yml --env-file deploy/crimson-prime/.env.example config --quiet
```

## Build the frontend image

The frontend image COPYs this repo's built `@emr-webmcp/openmrs-esm` artifact
(`apps/openmrs-esm/dist`, browser field `dist/openmrs-esm-esm.js`) and packs it
as `file:./emr-webmcp-openmrs-esm.tgz`. It is not fetched from npm.

```bash
npx -y corepack@0.36.0 yarn workspace @emr-webmcp/openmrs-esm build
docker compose -f deploy/crimson-prime/compose.yml --env-file deploy/crimson-prime/.env.example build frontend
```

`npx openmrs assemble/build` runs only inside `distribution/openmrs/frontend.Dockerfile`.
Do not run `npm install` in this repository. Yarn 4 only.

The assemble stage runs `verify-import-map.mjs` against `spa/importmap.json`
before the runtime image is emitted. Unit tests cover the same checker without Docker:

```bash
npx -y corepack@0.36.0 yarn vitest run --project distribution-openmrs
```

## Refresh pinned image digests

```bash
docker buildx imagetools inspect mariadb:10.11.7 --format '{{json .Manifest}}'
docker buildx imagetools inspect openmrs/openmrs-reference-application-3-backend:qa --format '{{json .Manifest}}'
docker buildx imagetools inspect openmrs/openmrs-reference-application-3-gateway:qa --format '{{json .Manifest}}'
docker buildx imagetools inspect node:22-alpine --format '{{json .Manifest}}'
docker buildx imagetools inspect nginx:1.31-alpine --format '{{json .Manifest}}'
```

Paste the `digest` field into `compose.yml` and `frontend.Dockerfile`. Keep the
tag (`10.11.7`, `qa`, `22-alpine`, `1.31-alpine`) next to the digest.

## Secrets

Copy `.env.example` to a VPS-only `.env` with mode 0600. Replace placeholders
there. Generated database passwords stay off git.
