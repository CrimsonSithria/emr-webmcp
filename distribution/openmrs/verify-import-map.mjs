#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WEBMCP_MODULE = '@emr-webmcp/openmrs-esm';
export const WEBMCP_FILE_SPEC = 'file:./emr-webmcp-openmrs-esm.tgz';

export const REQUIRED_IMPORT_MAP_MODULES = Object.freeze([
  WEBMCP_MODULE,
  '@openmrs/esm-patient-task-list-app',
  '@openmrs/esm-login-app',
  '@openmrs/esm-home-app',
  '@openmrs/esm-patient-chart-app',
  '@openmrs/esm-primary-navigation-app',
]);

/**
 * @param {unknown} importMap
 * @returns {{ ok: true, modules: readonly string[] }}
 */
export function verifyImportMap(importMap) {
  if (importMap === null || typeof importMap !== 'object' || Array.isArray(importMap)) {
    throw new Error('import map must be an object');
  }
  const imports = /** @type {{ imports?: unknown }} */ (importMap).imports;
  if (imports === null || typeof imports !== 'object' || Array.isArray(imports)) {
    throw new Error('import map missing imports');
  }

  const missing = REQUIRED_IMPORT_MAP_MODULES.filter((name) => {
    const url = /** @type {Record<string, unknown>} */ (imports)[name];
    return typeof url !== 'string' || url.length === 0;
  });
  if (missing.length > 0) {
    throw new Error(`import map missing modules: ${missing.join(', ')}`);
  }

  return { ok: true, modules: REQUIRED_IMPORT_MAP_MODULES };
}

/**
 * @param {unknown} config
 * @returns {{ webmcpSpec: string, modules: string[] }}
 */
export function verifyAssembleConfig(config) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('assemble config must be an object');
  }
  const frontendModules = /** @type {{ frontendModules?: unknown }} */ (config).frontendModules;
  if (frontendModules === null || typeof frontendModules !== 'object' || Array.isArray(frontendModules)) {
    throw new Error('assemble config missing frontendModules');
  }

  const modules = /** @type {Record<string, unknown>} */ (frontendModules);
  const webmcpSpec = modules[WEBMCP_MODULE];
  if (webmcpSpec !== WEBMCP_FILE_SPEC) {
    throw new Error(
      `${WEBMCP_MODULE} must be assembled from ${WEBMCP_FILE_SPEC}, got ${String(webmcpSpec)}`,
    );
  }

  const missing = REQUIRED_IMPORT_MAP_MODULES.filter((name) => {
    const spec = modules[name];
    return typeof spec !== 'string' || spec.length === 0;
  });
  if (missing.length > 0) {
    throw new Error(`assemble config missing modules: ${missing.join(', ')}`);
  }

  return { webmcpSpec, modules: Object.keys(modules) };
}

function main(argv) {
  const importMapPath = argv[0];
  if (typeof importMapPath !== 'string' || importMapPath.length === 0) {
    process.stderr.write('usage: verify-import-map.mjs <importmap.json>\n');
    process.exit(1);
  }
  const importMap = JSON.parse(readFileSync(importMapPath, 'utf8'));
  verifyImportMap(importMap);
}

const invokedAsCli =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsCli) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
