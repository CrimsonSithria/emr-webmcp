#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WEBMCP_MODULE = '@emr-webmcp/openmrs-esm';
export const WEBMCP_SPA_DIR = 'emr-webmcp-openmrs-esm-0.0.0';
export const WEBMCP_ENTRY = 'openmrs-esm-esm.js';

/**
 * O3 `next` assemble writes `{ routes: { "@openmrs/...": spec } }`.
 * Older assemble wrote module names at the top level. The app shell only
 * mounts pages from the nested table when that key is present.
 *
 * @param {unknown} registry
 * @returns {Record<string, unknown>}
 */
export function routeTable(registry) {
  if (registry === null || typeof registry !== 'object' || Array.isArray(registry)) {
    throw new Error('routes registry must be an object');
  }
  const nested = /** @type {{ routes?: unknown }} */ (registry).routes;
  if (nested !== null && typeof nested === 'object' && !Array.isArray(nested)) {
    return /** @type {Record<string, unknown>} */ (nested);
  }
  return /** @type {Record<string, unknown>} */ (registry);
}

/**
 * @param {string} spaDir
 * @param {string} moduleDir
 */
export function injectLocalModule(spaDir, moduleDir) {
  const entry = path.join(moduleDir, WEBMCP_ENTRY);
  if (!existsSync(entry)) {
    throw new Error(`local module entry missing: ${entry}`);
  }

  const dest = path.join(spaDir, WEBMCP_SPA_DIR);
  mkdirSync(spaDir, { recursive: true });
  cpSync(moduleDir, dest, { recursive: true });

  const importMapPath = path.join(spaDir, 'importmap.json');
  const importMap = JSON.parse(readFileSync(importMapPath, 'utf8'));
  if (importMap === null || typeof importMap !== 'object' || Array.isArray(importMap)) {
    throw new Error('import map must be an object');
  }
  if (importMap.imports === null || typeof importMap.imports !== 'object' || Array.isArray(importMap.imports)) {
    throw new Error('import map missing imports');
  }
  importMap.imports[WEBMCP_MODULE] = `./${WEBMCP_SPA_DIR}/${WEBMCP_ENTRY}`;
  writeFileSync(importMapPath, `${JSON.stringify(importMap, null, 2)}\n`);
  dropStaleEncodings(importMapPath);

  const routesPath = path.join(spaDir, 'routes.registry.json');
  const moduleRoutesPath = path.join(moduleDir, 'routes.json');
  const registry = existsSync(routesPath) ? JSON.parse(readFileSync(routesPath, 'utf8')) : {};
  if (registry === null || typeof registry !== 'object' || Array.isArray(registry)) {
    throw new Error('routes registry must be an object');
  }
  if (!existsSync(moduleRoutesPath)) {
    throw new Error(`local module routes missing: ${moduleRoutesPath}`);
  }
  const table = routeTable(registry);
  table[WEBMCP_MODULE] = JSON.parse(readFileSync(moduleRoutesPath, 'utf8'));
  if (table !== registry) {
    delete registry[WEBMCP_MODULE];
  }
  writeFileSync(routesPath, `${JSON.stringify(registry, null, 2)}\n`);
  dropStaleEncodings(routesPath);

  return { dest, importSpec: importMap.imports[WEBMCP_MODULE] };
}

/**
 * `openmrs build` writes `.br`/`.gz` siblings. nginx `try_files $uri.br`
 * serves those first. Leaving them after rewriting the JSON makes browsers
 * (which send Accept-Encoding: br) load the pre-inject 46-module registry.
 *
 * @param {string} filePath
 */
export function dropStaleEncodings(filePath) {
  for (const suffix of ['.br', '.gz']) {
    const sidecar = `${filePath}${suffix}`;
    if (existsSync(sidecar)) {
      unlinkSync(sidecar);
    }
  }
}

function main(argv) {
  const spaDir = argv[0];
  const moduleDir = argv[1];
  if (!spaDir || !moduleDir) {
    process.stderr.write('usage: inject-local-module.mjs <spaDir> <moduleDir>\n');
    process.exit(1);
  }
  injectLocalModule(spaDir, moduleDir);
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
