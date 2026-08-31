import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const nginxConfPath = join(here, 'nginx.conf');
const dockerfilePath = join(here, 'frontend.Dockerfile');

describe('SPA nginx runtime', () => {
  it('serves client routes through official try_files /index.html', () => {
    const nginx = readFileSync(nginxConfPath, 'utf8');

    expect(nginx).toMatch(/location\s+\/\s*\{[\s\S]*try_files\s+\/index\.html\s+=404;/);
    expect(nginx).toMatch(/listen\s+80;/);
    expect(nginx).toMatch(/root\s+\/usr\/share\/nginx\/html;/);
  });

  it('copies the SPA nginx.conf into the frontend image runtime stage', () => {
    const dockerfile = readFileSync(dockerfilePath, 'utf8');

    expect(dockerfile).toMatch(
      /COPY\s+distribution\/openmrs\/nginx\.conf\s+\/etc\/nginx\/nginx\.conf/,
    );
  });
});
