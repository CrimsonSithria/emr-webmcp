import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { injectLocalModule, WEBMCP_ENTRY, WEBMCP_MODULE, WEBMCP_SPA_DIR } from './inject-local-module.mjs';

describe('injectLocalModule', () => {
  it('copies the built artifact and records it in the import map and routes registry', () => {
    const root = mkdtempSync(join(tmpdir(), 'emr-webmcp-inject-'));
    const spaDir = join(root, 'spa');
    const moduleDir = join(root, 'module');
    mkdirSync(spaDir, { recursive: true });
    mkdirSync(moduleDir, { recursive: true });
    writeFileSync(join(moduleDir, WEBMCP_ENTRY), 'export default {};\n');
    writeFileSync(
      join(moduleDir, 'routes.json'),
      JSON.stringify({ pages: [{ route: 'emr-webmcp', component: 'root' }] }),
    );
    writeFileSync(
      join(spaDir, 'importmap.json'),
      JSON.stringify({ imports: { '@openmrs/esm-login-app': './openmrs-esm-login-app.js' } }),
    );
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
});
