import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';
import type { ToolResult } from '@emr-webmcp/core';

import { assertSurfaceCoverage, SYNTHETIC_DRAFT } from './manifest';

const APPOINTMENT_WINDOW = {
  start: '2026-08-31T00:00:00.000Z',
  end: '2026-09-06T23:59:59.000Z',
};

test('scenario manifest requires UI and WebMCP coverage for both-surface rows', () => {
  const ui = readFileSync(fileURLToPath(new URL('./ui-scenarios.spec.ts', import.meta.url)), 'utf8');
  const webmcp = readFileSync(fileURLToPath(new URL('./webmcp-scenarios.spec.ts', import.meta.url)), 'utf8');
  assertSurfaceCoverage({ ui, webmcp });
});

test.describe('WebMCP scenarios', () => {
  test('read-active-patient returns the current patient', async ({ page }) => {
    await openHarness(page);
    const result = await invoke(page, 'get_active_patient', {});
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ id: 'patient-1', display: 'Ada Lovelace' });
  });

  test('read-search-patients returns a bounded list', async ({ page }) => {
    await openHarness(page);
    const result = await invoke(page, 'search_patients', { query: 'patient', limit: 5 });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual([{ id: 'patient-1', display: 'Ada Lovelace' }]);
  });

  test('read-clinic-appointments returns the bounded window', async ({ page }) => {
    await openHarness(page);
    const result = await invoke(page, 'list_clinic_appointments', APPOINTMENT_WINDOW);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual([]);
  });

  test('read-chart-brief returns structured chart data', async ({ page }) => {
    await openHarness(page);
    const result = await invoke(page, 'get_chart_brief', { patientId: 'patient-1' });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        patient: { id: 'patient-1', display: 'Ada Lovelace' },
      }),
    );
  });

  test('read-unlatched-abnormal-results returns high and critical rows', async ({ page }) => {
    await openHarness(page);
    const result = await invoke(page, 'find_unlatched_abnormal_results', { limit: 100 });
    expect(result.ok).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
    expect((result.data as Array<{ interpretation: string }>).map((row) => row.interpretation)).toEqual(
      expect.arrayContaining(['high', 'critical-high']),
    );
  });

  test('read-result-context returns one result', async ({ page }) => {
    await openHarness(page);
    const result = await invoke(page, 'get_result_context', { resultId: 'obs-1' });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({ id: 'obs-1', interpretation: 'high' }),
      }),
    );
  });

  test('read-open-followups returns an empty open list', async ({ page }) => {
    await openHarness(page);
    const result = await invoke(page, 'list_open_followups', { limit: 20 });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual([]);
  });

  test('read-followup-assignees returns assignable people', async ({ page }) => {
    await openHarness(page);
    const result = await invoke(page, 'list_followup_assignees', { query: 'person', limit: 10 });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual([{ id: 'person-dr-chen', display: 'Dr. Chen', type: 'person' }]);
  });

  test('navigate-patient-chart records a chart navigation', async ({ page }) => {
    await openHarness(page);
    const result = await invoke(page, 'open_patient_chart', { patientId: 'patient-1' });
    expect(result.ok).toBe(true);
    expect(await page.evaluate(() => window.__harness.navigations())).toEqual([
      { kind: 'patient-chart', patientId: 'patient-1' },
    ]);
  });

  test('navigate-review-queue records a review navigation', async ({ page }) => {
    await openHarness(page);
    const result = await invoke(page, 'open_review_queue', {});
    expect(result.ok).toBe(true);
    expect(await page.evaluate(() => window.__harness.navigations())).toEqual([{ kind: 'review-queue' }]);
  });

  test('unsupported-capability returns a typed unsupported error', async ({ page }) => {
    await openHarness(page);
    await page.evaluate(() =>
      window.__harness.setCapabilities([
        'list-appointments',
        'get-chart-brief',
        'list-abnormal-results',
        'get-result',
        'list-followups',
        'list-assignees',
        'create-followup',
        'navigate-patient-chart',
        'navigate-tests',
        'navigate-tasks',
        'navigate-review-queue',
      ]),
    );
    const result = await invoke(page, 'search_patients', { query: 'patient', limit: 5 });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('unsupported');
  });

  test('unauthorized-read returns unauthorized from a stale tool handle', async ({ page }) => {
    await openHarness(page);
    const result = await page.evaluate(async (): Promise<ToolResult<unknown>> => {
      const tool = window.__modelContext.tool('search_patients');
      window.__harness.logout();
      return tool.execute({ query: 'patient', limit: 5 }, new AbortController().signal) as Promise<
        ToolResult<unknown>
      >;
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('unauthorized');
  });

  test('stale-draft blocks confirmation after the source disappears', async ({ page }) => {
    await openHarness(page);
    await invoke(page, 'stage_followup_task', SYNTHETIC_DRAFT);
    await page.evaluate(() => window.__harness.removeResult('obs-1'));
    await expect(page.getByTestId('confirm-followup')).toHaveAttribute('data-disabled-reason', 'stale-source');
    await page.getByTestId('confirm-followup').click({ force: true });
    expect(await page.evaluate(() => window.__harness.createdCount())).toBe(0);
  });

  test('duplicate-correlation rejects a second durable write', async ({ page }) => {
    await openHarness(page);
    await invoke(page, 'stage_followup_task', SYNTHETIC_DRAFT);
    await page.getByTestId('confirm-followup').click();
    await expect.poll(() => page.evaluate(() => window.__harness.createdCount())).toBe(1);
    const second = await invoke(page, 'stage_followup_task', SYNTHETIC_DRAFT);
    expect(second.ok).toBe(true);
    await expect(page.getByTestId('confirm-followup')).toHaveAttribute('data-disabled-reason', 'duplicate-active');
    await page.getByTestId('confirm-followup').click({ force: true });
    expect(await page.evaluate(() => window.__harness.createdCount())).toBe(1);
  });

  test('offline-confirm disables the visible confirmation gate', async ({ page }) => {
    await openHarness(page);
    await invoke(page, 'stage_followup_task', SYNTHETIC_DRAFT);
    await page.evaluate(() => window.__harness.setOnline(false));
    await expect(page.getByTestId('confirm-followup')).toHaveAttribute('data-disabled-reason', 'offline');
    await page.getByTestId('confirm-followup').click({ force: true });
    expect(await page.evaluate(() => window.__harness.createdCount())).toBe(0);
  });

  test('logout-teardown unregisters tools and clears drafts', async ({ page }) => {
    await openHarness(page);
    await invoke(page, 'stage_followup_task', SYNTHETIC_DRAFT);
    const before = await page.evaluate(() => window.__harness.unregisterCount());
    await page.evaluate(() => window.__harness.logout());
    await expect.poll(() => page.evaluate(() => window.__harness.toolNames())).toEqual([]);
    expect(await page.evaluate(() => window.__harness.unregisterCount())).toBe(before + 12);
    expect(await page.getByTestId('review-item').count()).toBe(0);
  });

  test('route-change replaces the registered generation', async ({ page }) => {
    await openHarness(page);
    const first = await page.evaluate(() => window.__harness.toolNames());
    const before = await page.evaluate(() => window.__harness.unregisterCount());
    await page.evaluate(() => window.__harness.changeRoute('/patient/patient-1/chart'));
    await expect.poll(() => page.evaluate(() => window.__harness.unregisterCount())).toBe(before + 12);
    expect(await page.evaluate(() => window.__harness.toolNames())).toEqual(first);
  });

  test('empty-clinic-reads returns empty collections', async ({ page }) => {
    await openHarness(page);
    await page.evaluate(() => window.__harness.setClinicProfile('empty'));
    const patients = await invoke(page, 'search_patients', { query: 'patient', limit: 20 });
    const appointments = await invoke(page, 'list_clinic_appointments', APPOINTMENT_WINDOW);
    const results = await invoke(page, 'find_unlatched_abnormal_results', { limit: 100 });
    expect(patients.ok).toBe(true);
    expect(appointments.ok).toBe(true);
    expect(results.ok).toBe(true);
    expect(patients.data).toEqual([]);
    expect(appointments.data).toEqual([]);
    expect(results.data).toEqual([]);
  });

  test('large-clinic-bounded-read never exceeds the tool limit', async ({ page }) => {
    await openHarness(page);
    await page.evaluate(() => window.__harness.setClinicProfile('large'));
    const patients = await invoke(page, 'search_patients', { query: 'patient-syn', limit: 20 });
    const results = await invoke(page, 'find_unlatched_abnormal_results', { limit: 100 });
    expect(patients.ok).toBe(true);
    expect(results.ok).toBe(true);
    expect((patients.data as unknown[]).length).toBeLessThanOrEqual(20);
    expect((results.data as unknown[]).length).toBeLessThanOrEqual(100);
    expect((patients.data as unknown[]).length).toBeGreaterThan(0);
  });

  test('abnormal-result-high exposes the high interpretation', async ({ page }) => {
    await openHarness(page);
    const result = await invoke(page, 'get_result_context', { resultId: 'obs-1' });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({ id: 'obs-1', interpretation: 'high' }),
      }),
    );
  });

  test('abnormal-result-critical exposes the critical interpretation', async ({ page }) => {
    await openHarness(page);
    const result = await invoke(page, 'get_result_context', { resultId: 'obs-critical-1' });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({ id: 'obs-critical-1', interpretation: 'critical-high' }),
      }),
    );
  });

  test('abnormal-result-unlatched has no matching active follow-up', async ({ page }) => {
    await openHarness(page);
    const result = await invoke(page, 'get_result_context', { resultId: 'obs-1' });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(expect.objectContaining({ followups: [] }));
  });

  test('human-confirm-followup creates exactly one task from a visible click', async ({ page }) => {
    await openHarness(page);
    await invoke(page, 'stage_followup_task', SYNTHETIC_DRAFT);
    expect(await page.evaluate(() => window.__harness.writeMethods())).toEqual([]);
    await page.getByTestId('confirm-followup').click();
    await expect.poll(() => page.evaluate(() => window.__harness.createdCount())).toBe(1);
    expect(await page.evaluate(() => window.__harness.carePlanPosts())).toHaveLength(1);
  });

  test('draft-stages-without-write performs no EMR write', async ({ page }) => {
    await openHarness(page);
    const staged = await invoke(page, 'stage_followup_task', SYNTHETIC_DRAFT);
    expect(staged.ok).toBe(true);
    expect(await page.evaluate(() => window.__harness.writeMethods())).toEqual([]);
    expect(await page.evaluate(() => window.__harness.createdCount())).toBe(0);
  });
});

async function openHarness(page: Page): Promise<void> {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => window.__harness.toolNames().length)).toBeGreaterThan(0);
}

async function invoke(page: Page, name: string, input: unknown) {
  return page.evaluate(({ name, input }) => window.__harness.invoke(name, input), { name, input });
}
