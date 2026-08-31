# syntax=docker/dockerfile:1.4
# Assemble + build the custom O3 frontend. `npx openmrs assemble/build` is
# allowed only in this image — never on the host repo (Yarn 4 only there).
#
# Build context is the repository root so the already-built
# `@emr-webmcp/openmrs-esm` artifact can be COPYed (not fetched from npm).
# Prerequisite: `npx -y corepack@0.36.0 yarn workspace @emr-webmcp/openmrs-esm build`
#
# Base-image digest refresh (document in deploy/crimson-prime/README.md):
#   docker buildx imagetools inspect node:22-alpine --format '{{json .Manifest}}'
#   docker buildx imagetools inspect nginx:1.31-alpine --format '{{json .Manifest}}'

FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS assemble

ARG APP_SHELL_VERSION=next

WORKDIR /app

# Pack the workspace build output as an npm tarball. openmrs assemble reads
# `file:` specs as tarball bytes (`package/package.json` + browser entry).
COPY apps/openmrs-esm/package.json /module/package/package.json
COPY apps/openmrs-esm/dist /module/package/dist
COPY apps/openmrs-esm/src/routes.json /module/package/dist/routes.json
RUN tar -czf /app/emr-webmcp-openmrs-esm.tgz -C /module package

COPY distribution/openmrs/spa-assemble-config.json /app/spa-assemble-config.json
COPY distribution/openmrs/spa-build-config.json /app/spa-build-config.json
COPY distribution/openmrs/verify-import-map.mjs /app/verify-import-map.mjs

ARG CACHE_BUST
RUN npx --legacy-peer-deps openmrs@${APP_SHELL_VERSION:-next} assemble --manifest --mode config --config spa-assemble-config.json --target ./spa
RUN node verify-import-map.mjs ./spa/importmap.json
RUN npx --legacy-peer-deps openmrs@${APP_SHELL_VERSION:-next} build --build-config spa-build-config.json --target ./spa
RUN if [ ! -f ./spa/index.html ]; then echo 'Build failed. Please check the logs above for details. This may have happened because of an update to a library that OpenMRS depends on.'; exit 1; fi

FROM nginx:1.31-alpine@sha256:db35bfc6b2951e7f8a72db5db120288c127ffaeeb4a6d4b95a26fead017d5913

RUN apk update && \
    apk upgrade && \
    apk add --no-cache moreutils curl

RUN rm -rf /usr/share/nginx/html/*

COPY distribution/openmrs/nginx.conf /etc/nginx/nginx.conf
COPY --from=assemble /app/spa /usr/share/nginx/html

# Runtime placeholder substitution matches the official O3 frontend image.
COPY <<'EOF' /usr/local/bin/startup.sh
#!/bin/sh
set -e

if [ -z "$SPA_CONFIG_URLS" ]; then
  sed -i -e 's/"$SPA_CONFIG_URLS"//' /usr/share/nginx/html/index.html
else
  old_IFS="$IFS"
  if echo "$SPA_CONFIG_URLS" | grep , >/dev/null; then
    IFS=","
  fi
  CONFIG_URLS=
  for url in $SPA_CONFIG_URLS; do
    if [ -z "$CONFIG_URLS" ]; then
      CONFIG_URLS="\"${url}\""
    else
      CONFIG_URLS="$CONFIG_URLS,\"${url}\""
    fi
  done
  IFS="$old_IFS"
  export SPA_CONFIG_URLS=$CONFIG_URLS
  sed -i -e 's/"$SPA_CONFIG_URLS"/$SPA_CONFIG_URLS/' /usr/share/nginx/html/index.html
fi

SPA_DEFAULT_LOCALE=${SPA_DEFAULT_LOCALE:-en_GB}

if [ -f /usr/share/nginx/html/index.html ]; then
  envsubst '${IMPORTMAP_URL} ${SPA_PATH} ${API_URL} ${SPA_CONFIG_URLS} ${SPA_DEFAULT_LOCALE}' \
    < /usr/share/nginx/html/index.html | sponge /usr/share/nginx/html/index.html
fi

exec nginx -g "daemon off;"
EOF

RUN chmod +x /usr/local/bin/startup.sh

CMD ["/usr/local/bin/startup.sh"]
