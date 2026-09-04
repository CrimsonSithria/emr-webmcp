#!/usr/bin/env node
/**
 * LabLatch Devpost screen recording — v4
 * Uses the real LabLatch agent-activity panel. No fake overlays for tool calls.
 *
 * Env: OPENMRS_ORIGIN, OPENMRS_USERNAME, OPENMRS_PASSWORD
 * Out: /tmp/emr-webmcp-contrast-v4/*.webm
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(path.join(repoRoot, 'package.json'));
const { chromium } = require('playwright');

const origin = process.env.OPENMRS_ORIGIN || 'https://ottawa-desert-insert-alternative.trycloudflare.com';
const username = process.env.OPENMRS_USERNAME;
const password = process.env.OPENMRS_PASSWORD;
if (!username || !password) throw new Error('missing OPENMRS_USERNAME / OPENMRS_PASSWORD');

const outDir = process.env.DEMO_VIDEO_DIR || '/tmp/emr-webmcp-contrast-v4';
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

async function waitResults(page) {
  await page.getByRole('heading', { name: /Results/i }).first().waitFor({ timeout: 45_000 }).catch(() => undefined);
  const visibleLab = page.getByText(/g\/dL|mmol\/L|mg\/dL/i).filter({ visible: true }).first();
  await visibleLab.waitFor({ state: 'visible', timeout: 45_000 });
  await page.waitForTimeout(800);
}

async function waitForTools(page) {
  await page.waitForFunction(
    async () => {
      const host = document.modelContext;
      if (!host?.getTools) return false;
      const list = await host.getTools();
      return list.some((tool) => tool.name === 'stage_followup_task');
    },
    null,
    { timeout: 25_000 },
  );
}

async function runTool(page, name, input) {
  return page.evaluate(
    async ({ name, input }) => {
      const host = document.modelContext;
      if (!host?.getTools) return { error: 'no-host' };
      const tool = (await host.getTools()).find((candidate) => candidate.name === name);
      if (!tool) return { error: `missing ${name}` };
      const raw = await host.executeTool(tool, JSON.stringify(input));
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    },
    { name, input },
  );
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
const page = await context.newPage();
page.setDefaultTimeout(180_000);

const demoPatient = process.env.DEMO_PATIENT_ID || '327062b2-8d19-4627-be3c-fd585c315330';
await page.goto(`${origin}/openmrs/spa/patient/${demoPatient}/chart/Results`, {
  waitUntil: 'domcontentloaded',
  timeout: 60_000,
});
await waitResults(page);
await page.mouse.wheel(0, 350);
await page.waitForTimeout(8000);

await page.goto(`${origin}/openmrs/spa/emr-webmcp`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.getByTestId('webmcp-host-ready').waitFor({ timeout: 25_000 });
await page.getByTestId('agent-activity').waitFor({ timeout: 10_000 });
await page.waitForTimeout(1500);
await waitForTools(page);

const hunt = runTool(page, 'find_unlatched_abnormal_results', { limit: 20 });
await page.getByTestId('agent-activity-tool').getByText('Hunt unlatched abnormal labs').waitFor({ timeout: 15_000 });
const found = await hunt;
const items = Array.isArray(found?.data) ? found.data : [];
await page.getByTestId('agent-activity-lines').getByText(/unlatched abnormal labs/).waitFor({ timeout: 15_000 });
await page.waitForTimeout(5000);

const pick =
  items.find((item) => /Donald Harris/i.test(item?.patient?.display ?? '')) ??
  items.find((item) => item?.patient?.id && item?.sourceReference) ??
  items[0];
if (!pick) {
  const video = page.video();
  await context.close();
  await browser.close();
  throw new Error(JSON.stringify({ error: 'no-unlatched', count: items.length }));
}

const staged = runTool(page, 'stage_followup_task', {
  patient: pick.patient,
  title: 'Review unlatched abnormal lab',
  rationale: 'Unowned high-risk result from LabLatch.',
  priority: 'high',
  sourceReference: pick.sourceReference,
});
await page.getByTestId('agent-activity-tool').getByText('Stage follow-up draft').waitFor({ timeout: 15_000 });
const draft = await staged;
if (!draft?.ok) {
  const video = page.video();
  await context.close();
  await browser.close();
  throw new Error(JSON.stringify({ error: 'stage-failed', draft }));
}

await page.locator('[data-testid="review-item"]').first().waitFor({ timeout: 20_000 });
await page.waitForTimeout(4000);

const confirmBtn = page.getByTestId('confirm-followup').first();
await confirmBtn.scrollIntoViewIfNeeded();
await page.waitForTimeout(1500);
if (await confirmBtn.isEnabled()) {
  await confirmBtn.click();
  await page.getByTestId('confirmed-followup').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(4000);
}

console.log(
  JSON.stringify({
    ok: Boolean(draft?.ok),
    count: items.length,
    patient: pick.patient?.display ?? null,
    draftId: draft?.data?.draftId ?? null,
  }),
);
const video = page.video();
await context.close();
await browser.close();
console.log(JSON.stringify({ videoPath: video ? await video.path() : null, outDir }));
