#!/usr/bin/env node
/**
 * LabLatch Devpost screen recording — v3
 * Matches docs/demo-voiceover-script.md (~90s)
 *
 * Env: OPENMRS_ORIGIN, OPENMRS_USERNAME, OPENMRS_PASSWORD
 * Out: /tmp/emr-webmcp-contrast-v3/*.webm
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(path.join(repoRoot, 'package.json'));
const { chromium } = require('playwright');

const origin = process.env.OPENMRS_ORIGIN || 'https://ottawa-desert-insert-alternative.trycloudflare.com';
const username = process.env.OPENMRS_USERNAME;
const password = process.env.OPENMRS_PASSWORD;
if (!username || !password) throw new Error('missing OPENMRS_USERNAME / OPENMRS_PASSWORD');

const outDir = process.env.DEMO_VIDEO_DIR || '/tmp/emr-webmcp-contrast-v3';
mkdirSync(outDir, { recursive: true });

const executablePath =
  process.env.PLAYWRIGHT_CHROME ||
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const hideToasts = `
(() => {
  const kill = () => {
    for (const el of document.querySelectorAll('[class*="notification"], [class*="toast"]')) {
      const text = el.textContent || '';
      if (text.includes('unresolved backend') || text.includes('Implementer Tools')) el.remove();
    }
  };
  kill();
  setInterval(kill, 400);
})();
`;

const agentPanel = `
(() => {
  window.__showAgent = (title, lines) => {
    let el = document.getElementById('lablatch-agent');
    if (!el) {
      el = document.createElement('div');
      el.id = 'lablatch-agent';
      el.style.cssText = 'position:fixed;right:24px;bottom:24px;z-index:2147483646;width:420px;background:#0e151b;border:1px solid #2a3640;color:#e8eef2;font:16px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;padding:16px;box-shadow:0 8px 32px #0008';
      document.body.appendChild(el);
    }
    const safe = (value) => String(value).replace(/[<>&"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
    el.innerHTML = '<div style="color:#6ec3c1;letter-spacing:.16em;text-transform:uppercase;font-size:12px;margin-bottom:8px">Agent on this page</div>'
      + '<div style="font-size:20px;font-weight:650;margin-bottom:10px">' + safe(title) + '</div>'
      + lines.map((l) => '<div style="color:#8b9aa6;margin:4px 0;font-family:ui-monospace,monospace;font-size:14px">' + safe(l) + '</div>').join('');
  };
})();
`;

async function login(browser) {
  const login = await browser.newContext({
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
    viewport: { width: 1440, height: 900 },
  });
  const page = await login.newPage();
  await page.goto(`${origin}/openmrs/spa/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByRole('textbox', { name: 'Username' }).fill(username);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  try {
    const ward = page.getByRole('button', { name: /Outpatient Clinic|Inpatient Ward/i }).first();
    await ward.waitFor({ timeout: 15_000 });
    await ward.click();
    const confirm = page.getByRole('button', { name: /^Confirm$/i }).first();
    if (await confirm.isVisible({ timeout: 5_000 }).catch(() => false)) await confirm.click();
  } catch {
    /* seated */
  }
  await page.waitForTimeout(1500);
  const storageState = await login.storageState();
  await login.close();
  return storageState;
}

async function overlay(page, eyebrow, title, sub, ms) {
  await page.evaluate(
    ({ eyebrow, title, sub }) => {
      document.getElementById('lablatch-card')?.remove();
      const el = document.createElement('div');
      el.id = 'lablatch-card';
      el.style.cssText =
        'position:fixed;inset:0;z-index:2147483647;background:#0b1014;color:#e8eef2;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,sans-serif';
      el.innerHTML = `<div style="letter-spacing:.22em;text-transform:uppercase;color:#6ec3c1;font-size:16px;margin-bottom:18px">${eyebrow}</div><h1 style="font-size:52px;margin:0 0 14px;font-weight:650">${title}</h1><p style="color:#8b9aa6;font-size:24px;margin:0;max-width:720px;text-align:center">${sub}</p>`;
      document.body.appendChild(el);
    },
    { eyebrow, title, sub },
  );
  await page.waitForTimeout(ms);
  await page.evaluate(() => document.getElementById('lablatch-card')?.remove());
}

async function waitResults(page) {
  await page.getByRole('heading', { name: /Results/i }).first().waitFor({ timeout: 45_000 }).catch(() => undefined);
  const visibleLab = page.getByText(/g\/dL|mmol\/L|mg\/dL/i).filter({ visible: true }).first();
  await visibleLab.waitFor({ state: 'visible', timeout: 45_000 });
  await page.waitForTimeout(1200);
}

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--enable-features=WebMCP,WebMCPTesting'],
});
const storageState = await login(browser);
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  serviceWorkers: 'block',
  storageState,
  recordVideo: { dir: outDir, size: { width: 1440, height: 900 } },
  viewport: { width: 1440, height: 900 },
});
await context.addInitScript(hideToasts);
await context.addInitScript(agentPanel);
const page = await context.newPage();

// 0:00 hook
await overlay(page, 'WebMCP Challenge', 'LabLatch', 'The agent hunts. The doctor decides.', 6000);

// 0:06 problem — one patient, varied labs (post reseed)
const demoPatient = process.env.DEMO_PATIENT_ID || '327062b2-8d19-4627-be3c-fd585c315330';
await page.goto(`${origin}/openmrs/spa/patient/${demoPatient}/chart/Results`, {
  waitUntil: 'domcontentloaded',
  timeout: 60_000,
});
await waitResults(page);
await page.mouse.wheel(0, 350);
await page.waitForTimeout(14000);

// 0:22 transition
await overlay(
  page,
  'Unlatched results',
  'Abnormal lab. No follow-up yet.',
  'LabLatch finds them clinic-wide — you confirm the only chart write.',
  10000,
);

// 0:32 MCP
await page.goto(`${origin}/openmrs/spa/emr-webmcp`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.getByTestId('webmcp-host-ready').waitFor({ timeout: 25_000 });
await page.waitForTimeout(1000);

const staged = await page.evaluate(async () => {
  const host = document.modelContext;
  if (!host?.getTools) return { error: 'no-host' };
  const show = (title, lines) => window.__showAgent?.(title, lines);
  const run = async (name, input) => {
    const tool = (await host.getTools()).find((candidate) => candidate.name === name);
    if (!tool) return { ok: false, error: `missing ${name}` };
    const raw = await host.executeTool(tool, JSON.stringify(input));
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  };
  const t0 = performance.now();
  while (performance.now() - t0 < 25_000) {
    const list = await host.getTools();
    if (list.some((tool) => tool.name === 'stage_followup_task')) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  show('find_unlatched_abnormal_results', ['→ find_unlatched_abnormal_results', '{ limit: 20 }']);
  await new Promise((r) => setTimeout(r, 3500));
  const found = await run('find_unlatched_abnormal_results', { limit: 20 });
  const items = Array.isArray(found?.data) ? found.data : [];
  const names = [...new Set(items.map((i) => i?.patient?.display?.split('(')[0]?.trim()).filter(Boolean))].slice(0, 5);
  show('Unlatched hits', [
    `→ ${items.length} abnormal labs without follow-up`,
    ...names.map((n) => `• ${n}`),
  ]);
  await new Promise((r) => setTimeout(r, 9000));

  const pick =
    items.find((item) => /Donald Harris/i.test(item?.patient?.display ?? '')) ??
    items.find((item) => item?.patient?.id && item?.sourceReference) ??
    items[0];
  if (!pick) return { error: 'no-unlatched', count: items.length };

  show('stage_followup_task', [
    '→ stage_followup_task',
    `patient: ${pick.patient.display}`,
    'priority: high · draft only',
  ]);
  await new Promise((r) => setTimeout(r, 3500));
  const draft = await run('stage_followup_task', {
    patient: pick.patient,
    title: 'Review unlatched abnormal lab',
    rationale: 'Unowned high-risk result from LabLatch.',
    priority: 'high',
    sourceReference: pick.sourceReference,
  });
  document.getElementById('lablatch-agent')?.remove();
  return {
    ok: Boolean(draft?.ok),
    count: items.length,
    patient: pick.patient?.display ?? null,
    draftId: draft?.data?.draftId ?? null,
  };
});

if (staged.error) {
  const video = page.video();
  await context.close();
  await browser.close();
  throw new Error(JSON.stringify(staged));
}

// 0:55 review queue
await page.locator('[data-testid="review-item"]').first().waitFor({ timeout: 20_000 });
await page.waitForTimeout(18000);

const confirmBtn = page.getByTestId('confirm-followup').first();
await confirmBtn.scrollIntoViewIfNeeded();
await page.waitForTimeout(2000);
if (await confirmBtn.isEnabled()) {
  await confirmBtn.click();
  await page.waitForTimeout(4000);
}

// 1:18 outro
await overlay(
  page,
  'LabLatch',
  'The agent hunts. The doctor decides.',
  'Confirm follow-up is the only chart write.',
  12000,
);

console.log(JSON.stringify(staged));
const video = page.video();
await context.close();
await browser.close();
console.log(JSON.stringify({ videoPath: video ? await video.path() : null, outDir }));
