#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WEBMCP_MODULE = '@emr-webmcp/openmrs-esm';
export const WEBMCP_SPA_DIR = 'emr-webmcp-openmrs-esm-0.0.0';
export const WEBMCP_ENTRY = 'openmrs-esm-esm.js';

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

  const routesPath = path.join(spaDir, 'routes.registry.json');
  const moduleRoutesPath = path.join(moduleDir, 'routes.json');
  const registry = existsSync(routesPath) ? JSON.parse(readFileSync(routesPath, 'utf8')) : {};
  if (registry === null || typeof registry !== 'object' || Array.isArray(registry)) {
    throw new Error('routes registry must be an object');
  }
  if (!existsSync(moduleRoutesPath)) {
    throw new Error(`local module routes missing: ${moduleRoutesPath}`);
  }
  registry[WEBMCP_MODULE] = JSON.parse(readFileSync(moduleRoutesPath, 'utf8'));
  writeFileSync(routesPath, `${JSON.stringify(registry, null, 2)}\n`);

  return { dest, importSpec: importMap.imports[WEBMCP_MODULE] };
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
