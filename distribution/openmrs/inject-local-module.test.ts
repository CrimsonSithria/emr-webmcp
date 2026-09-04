import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  injectLocalModule,
  routeTable,
  WEBMCP_ENTRY,
  WEBMCP_MODULE,
  WEBMCP_SPA_DIR,
} from './inject-local-module.mjs';

function writeModule(moduleDir: string): void {
  writeFileSync(join(moduleDir, WEBMCP_ENTRY), 'export default {};\n');
  writeFileSync(
    join(moduleDir, 'routes.json'),
    JSON.stringify({ pages: [{ route: 'emr-webmcp', component: 'root' }] }),
  );
}

function writeImportMap(spaDir: string): void {
  writeFileSync(
    join(spaDir, 'importmap.json'),
    JSON.stringify({ imports: { '@openmrs/esm-login-app': './openmrs-esm-login-app.js' } }),
  );
}

describe('injectLocalModule', () => {
  it('copies the built artifact and records it in a flat routes registry', () => {
    const root = mkdtempSync(join(tmpdir(), 'emr-webmcp-inject-'));
    const spaDir = join(root, 'spa');
    const moduleDir = join(root, 'module');
    mkdirSync(spaDir, { recursive: true });
    mkdirSync(moduleDir, { recursive: true });
    writeModule(moduleDir);
    writeImportMap(spaDir);
    writeFileSync(join(spaDir, 'routes.registry.json'), JSON.stringify({ '@openmrs/esm-login-app': { pages: [] } }));

    const result = injectLocalModule(spaDir, moduleDir);

    const importMap = JSON.parse(readFileSync(join(spaDir, 'importmap.json'), 'utf8')) as {
      imports: Record<string, string>;
    };
    const registry = JSON.parse(readFileSync(join(spaDir, 'routes.registry.json'), 'utf8')) as Record<
      string,
      { pages: Array<{ route: string }> }
    >;

    expect(result.importSpec).toBe(`./${WEBMCP_SPA_DIR}/${WEBMCP_ENTRY}`);
    expect(importMap.imports[WEBMCP_MODULE]).toBe(`./${WEBMCP_SPA_DIR}/${WEBMCP_ENTRY}`);
    expect(importMap.imports['@openmrs/esm-login-app']).toBe('./openmrs-esm-login-app.js');
    expect(registry[WEBMCP_MODULE]?.pages?.[0]?.route).toBe('emr-webmcp');
    expect(readFileSync(join(spaDir, WEBMCP_SPA_DIR, WEBMCP_ENTRY), 'utf8')).toContain('export default');
  });

  it('writes into nested routes and drops a leftover top-level module key', () => {
    const root = mkdtempSync(join(tmpdir(), 'emr-webmcp-inject-nested-'));
    const spaDir = join(root, 'spa');
    const moduleDir = join(root, 'module');
    mkdirSync(spaDir, { recursive: true });
    mkdirSync(moduleDir, { recursive: true });
    writeModule(moduleDir);
    writeImportMap(spaDir);
    writeFileSync(
      join(spaDir, 'routes.registry.json'),
      JSON.stringify({
        routes: { '@openmrs/esm-login-app': { pages: [{ route: 'login' }] } },
        [WEBMCP_MODULE]: { pages: [{ route: 'stale' }] },
      }),
    );

    injectLocalModule(spaDir, moduleDir);

    const registry = JSON.parse(readFileSync(join(spaDir, 'routes.registry.json'), 'utf8')) as {
      routes: Record<string, { pages: Array<{ route: string }> }>;
    };

    expect(Object.prototype.hasOwnProperty.call(registry, WEBMCP_MODULE)).toBe(false);
    expect(registry.routes[WEBMCP_MODULE]?.pages?.[0]?.route).toBe('emr-webmcp');
    expect(registry.routes['@openmrs/esm-login-app']?.pages?.[0]?.route).toBe('login');
    expect(routeTable(registry)[WEBMCP_MODULE]).toEqual({
      pages: [{ route: 'emr-webmcp', component: 'root' }],
    });
  });

  it('deletes precompressed sidecars so nginx cannot serve a stale registry', () => {
    const root = mkdtempSync(join(tmpdir(), 'emr-webmcp-inject-enc-'));
    const spaDir = join(root, 'spa');
    const moduleDir = join(root, 'module');
    mkdirSync(spaDir, { recursive: true });
    mkdirSync(moduleDir, { recursive: true });
    writeModule(moduleDir);
    writeImportMap(spaDir);
    writeFileSync(join(spaDir, 'routes.registry.json'), JSON.stringify({ routes: {} }));
    writeFileSync(join(spaDir, 'importmap.json.br'), 'stale-import');
    writeFileSync(join(spaDir, 'importmap.json.gz'), 'stale-import-gz');
    writeFileSync(join(spaDir, 'routes.registry.json.br'), 'stale-routes');
    writeFileSync(join(spaDir, 'routes.registry.json.gz'), 'stale-routes-gz');

    injectLocalModule(spaDir, moduleDir);

    expect(existsSync(join(spaDir, 'importmap.json.br'))).toBe(false);
    expect(existsSync(join(spaDir, 'importmap.json.gz'))).toBe(false);
    expect(existsSync(join(spaDir, 'routes.registry.json.br'))).toBe(false);
    expect(existsSync(join(spaDir, 'routes.registry.json.gz'))).toBe(false);
  });
});
