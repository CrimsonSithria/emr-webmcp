import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  REQUIRED_IMPORT_MAP_MODULES,
  WEBMCP_FILE_SPEC,
  WEBMCP_MODULE,
  verifyAssembleConfig,
  verifyImportMap,
} from './verify-import-map.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const assembleConfigPath = join(here, 'spa-assemble-config.json');
const verifyScriptPath = join(here, 'verify-import-map.mjs');
const modulePackagePath = join(here, '../../apps/openmrs-esm/package.json');

const OFFICIAL_REFERENCE_MODULES = [
  '@openmrs/esm-login-app',
  '@openmrs/esm-home-app',
  '@openmrs/esm-patient-chart-app',
  '@openmrs/esm-primary-navigation-app',
  '@openmrs/esm-patient-task-list-app',
] as const;

function loadAssembleConfig(): unknown {
  return JSON.parse(readFileSync(assembleConfigPath, 'utf8'));
}

function writeImportMap(imports: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'emr-webmcp-import-map-'));
  const path = join(dir, 'importmap.json');
  writeFileSync(path, JSON.stringify({ imports }));
  return path;
}

describe('spa-assemble-config', () => {
  it('pins the built WebMCP artifact via file: URL alongside official O3 modules and Tasks', () => {
    const config = loadAssembleConfig();
    const verified = verifyAssembleConfig(config);

    expect(verified.webmcpSpec).toBe(WEBMCP_FILE_SPEC);
    expect(verified.webmcpSpec.startsWith('file:')).toBe(true);
    expect(verified.webmcpSpec).not.toMatch(/registry\.npmjs|https?:\/\//);
    expect(verified.modules).toEqual(expect.arrayContaining([...OFFICIAL_REFERENCE_MODULES, WEBMCP_MODULE]));

    const modules = (config as { frontendModules: Record<string, string> }).frontendModules;
    expect(modules[WEBMCP_MODULE]).toBe(WEBMCP_FILE_SPEC);
    expect(modules['@openmrs/esm-patient-task-list-app']).toBeTruthy();
    for (const name of OFFICIAL_REFERENCE_MODULES) {
      expect(modules[name]).toBeTruthy();
    }
  });

  it('requires the workspace browser artifact that assemble packs into the tarball', () => {
    const pkg = JSON.parse(readFileSync(modulePackagePath, 'utf8')) as {
      name: string;
      browser: string;
    };
    expect(pkg.name).toBe(WEBMCP_MODULE);
    expect(pkg.browser).toBe('dist/openmrs-esm-esm.js');
  });
});

describe('verifyImportMap', () => {
  it('accepts an assembled import map that includes WebMCP, Tasks, and reference modules', () => {
    const imports: Record<string, string> = Object.fromEntries(
      REQUIRED_IMPORT_MAP_MODULES.map((name) => [
        name,
        name === WEBMCP_MODULE
          ? './emr-webmcp-openmrs-esm-0.0.0/openmrs-esm-esm.js'
          : `./${name.replace(/^@/, '').replace('/', '-')}-next/${name.split('/').at(-1)}.js`,
      ]),
    );

    expect(verifyImportMap({ imports }).ok).toBe(true);
  });

  it('rejects an import map that omits the built WebMCP artifact or Tasks', () => {
    const imports = Object.fromEntries(
      REQUIRED_IMPORT_MAP_MODULES.filter((name) => name !== WEBMCP_MODULE).map((name) => [
        name,
        `./${name}.js`,
      ]),
    );

    expect(() => verifyImportMap({ imports })).toThrow(/@emr-webmcp\/openmrs-esm/);
    expect(() =>
      verifyImportMap({
        imports: { [WEBMCP_MODULE]: './emr-webmcp-openmrs-esm-0.0.0/openmrs-esm-esm.js' },
      }),
    ).toThrow(/@openmrs\/esm-patient-task-list-app/);
  });
});

describe('verify-import-map CLI', () => {
  it('exits 0 for a complete import map and 1 when WebMCP is missing', () => {
    const complete = writeImportMap(
      Object.fromEntries(REQUIRED_IMPORT_MAP_MODULES.map((name) => [name, `./${name}.js`])),
    );
    const missing = writeImportMap({
      '@openmrs/esm-login-app': './openmrs-esm-login-app.js',
    });

    const pass = spawnSync(process.execPath, [verifyScriptPath, complete], { encoding: 'utf8' });
    const fail = spawnSync(process.execPath, [verifyScriptPath, missing], { encoding: 'utf8' });

    expect(pass.status).toBe(0);
    expect(fail.status).toBe(1);
    expect(fail.stderr).toMatch(/@emr-webmcp\/openmrs-esm/);
  });
});
