import { expect, test, type Page } from '@playwright/test';

import { SYNTHETIC_DRAFT } from './manifest';

test.describe('UI scenarios', () => {
  test('read-active-patient shows the current patient id', async ({ page }) => {
    await openHarness(page);
    await page.getByTestId('refresh-reads').click();
    await expect(page.getByTestId('active-patient')).toHaveText('patient-1');
  });

  test('read-search-patients lists matching ids from the search control', async ({ page }) => {
    await openHarness(page);
    await page.getByTestId('patient-search').fill('patient');
    await page.getByTestId('patient-search-submit').click();
    await expect(page.getByTestId('patient-search-results')).toContainText('patient-1');
  });

  test('read-clinic-appointments renders the appointment list', async ({ page }) => {
    await openHarness(page);
    await page.getByTestId('refresh-reads').click();
    await expect(page.getByTestId('appointment-list')).toHaveText('');
  });

  test('read-chart-brief renders a bounded chart summary', async ({ page }) => {
    await openHarness(page);
    await page.getByTestId('refresh-reads').click();
    await expect(page.getByTestId('chart-brief')).toHaveText('results=2');
  });

  test('read-unlatched-abnormal-results lists abnormal interpretations', async ({ page }) => {
    await openHarness(page);
    await page.getByTestId('refresh-reads').click();
    await expect(page.getByTestId('abnormal-results')).toContainText('obs-1:high');
    await expect(page.getByTestId('abnormal-results')).toContainText('obs-critical-1:critical-high');
  });

  test('read-result-context shows the selected high result', async ({ page }) => {
    await openHarness(page);
    await page.getByTestId('refresh-reads').click();
    await expect(page.getByTestId('abnormal-results')).toContainText('obs-1:high');
  });

  test('read-open-followups shows no durable tasks before confirm', async ({ page }) => {
    await openHarness(page);
    await page.getByTestId('refresh-reads').click();
    await expect(page.getByTestId('followup-list')).toHaveText('');
  });

  test('read-followup-assignees lists assignable people', async ({ page }) => {
    await openHarness(page);
    await page.getByTestId('refresh-reads').click();
    await expect(page.getByTestId('assignee-list')).toContainText('person-dr-chen');
  });

  test('navigate-patient-chart uses the ordinary chart control', async ({ page }) => {
    await openHarness(page);
    await page.getByTestId('navigate-chart').click();
    expect(await page.evaluate(() => window.__harness.navigations())).toEqual([
      { kind: 'patient-chart', patientId: 'patient-1' },
    ]);
  });

  test('navigate-review-queue uses the ordinary review control', async ({ page }) => {
    await openHarness(page);
    await page.getByTestId('navigate-review').click();
    expect(await page.evaluate(() => window.__harness.navigations())).toEqual([{ kind: 'review-queue' }]);
  });

  test('unsupported-capability hides search when the capability is absent', async ({ page }) => {
    await openHarness(page);
    await page.evaluate(() => window.__harness.setCapabilities([]));
    await expect(page.getByTestId('unsupported-note')).toBeVisible();
    expect(await page.evaluate(() => window.__harness.toolNames())).not.toContain('search_patients');
  });

  test('unauthorized-read signs the UI out and removes tools', async ({ page }) => {
    await openHarness(page);
    await page.getByTestId('logout').click();
    await expect(page.getByTestId('auth-state')).toHaveText('signed-out');
    await expect.poll(() => page.evaluate(() => window.__harness.toolNames())).toEqual([]);
  });

  test('stale-draft disables the visible confirm control', async ({ page }) => {
    await openHarness(page);
    await page.getByTestId('stage-followup').click();
    await page.evaluate(() => window.__harness.removeResult('obs-1'));
    await expect(page.getByTestId('confirm-followup')).toHaveAttribute('data-disabled-reason', 'stale-source');
    await page.getByTestId('confirm-followup').click({ force: true });
    expect(await page.evaluate(() => window.__harness.createdCount())).toBe(0);
  });

  test('duplicate-correlation keeps a second confirm from writing', async ({ page }) => {
    await openHarness(page);
    await page.getByTestId('stage-followup').click();
    await page.getByTestId('confirm-followup').click();
    await expect.poll(() => page.evaluate(() => window.__harness.createdCount())).toBe(1);
    await page.getByTestId('stage-followup').click();
    await expect(page.getByTestId('confirm-followup')).toHaveAttribute('data-disabled-reason', 'duplicate-active');
    await page.getByTestId('confirm-followup').click({ force: true });
    expect(await page.evaluate(() => window.__harness.createdCount())).toBe(1);
  });

  test('offline-confirm disables confirmation without a write', async ({ page }) => {
    await openHarness(page);
    await page.getByTestId('stage-followup').click();
    await page.evaluate(() => window.__harness.setOnline(false));
    await expect(page.getByTestId('confirm-followup')).toHaveAttribute('data-disabled-reason', 'offline');
    await page.getByTestId('confirm-followup').click({ force: true });
    expect(await page.evaluate(() => window.__harness.createdCount())).toBe(0);
  });

  test('logout-teardown clears the review queue from the logout control', async ({ page }) => {
    await openHarness(page);
    await page.getByTestId('stage-followup').click();
    expect(await page.getByTestId('review-item').count()).toBe(1);
    await page.getByTestId('logout').click();
    await expect(page.getByTestId('auth-state')).toHaveText('signed-out');
    expect(await page.getByTestId('review-item').count()).toBe(0);
    expect(await page.evaluate(() => window.__harness.toolNames())).toEqual([]);
  });

  test('route-change replaces registrations from the route control', async ({ page }) => {
    await openHarness(page);
    const before = await page.evaluate(() => window.__harness.unregisterCount());
    await page.getByTestId('route-input').fill('/patient/patient-1/chart');
    await page.getByTestId('apply-route').click();
    await expect.poll(() => page.evaluate(() => window.__harness.unregisterCount())).toBe(before + 12);
    expect(await page.evaluate(() => window.__harness.toolNames().length)).toBe(12);
  });

  test('empty-clinic-reads shows empty collections', async ({ page }) => {
    await openHarness(page);
    await page.evaluate(() => window.__harness.setClinicProfile('empty'));
    await page.getByTestId('patient-search').fill('patient');
    await page.getByTestId('patient-search-submit').click();
    await page.getByTestId('refresh-reads').click();
    await expect(page.getByTestId('clinic-profile')).toHaveText('empty');
    await expect(page.getByTestId('patient-search-results')).toHaveText('');
    await expect(page.getByTestId('appointment-list')).toHaveText('');
    await expect(page.getByTestId('abnormal-results')).toHaveText('');
    await expect(page.getByTestId('active-patient')).toHaveText('none');
  });

  test('large-clinic-bounded-read caps the visible search list at 20', async ({ page }) => {
    await openHarness(page);
    await page.evaluate(() => window.__harness.setClinicProfile('large'));
    await page.getByTestId('patient-search').fill('patient-syn');
    await page.getByTestId('patient-search-submit').click();
    await expect.poll(async () => page.evaluate(() => window.__harness.clinicCounts().shownPatients)).toBe(20);
    const counts = await page.evaluate(() => window.__harness.clinicCounts());
    expect(counts.patients).toBe(80);
    expect(counts.shownPatients).toBeLessThanOrEqual(20);
  });

  test('abnormal-result-high is visible in the review list', async ({ page }) => {
    await openHarness(page);
    await page.getByTestId('refresh-reads').click();
    await expect(page.getByTestId('abnormal-results')).toContainText('obs-1:high');
  });

  test('abnormal-result-critical is visible in the review list', async ({ page }) => {
    await openHarness(page);
    await page.getByTestId('refresh-reads').click();
    await expect(page.getByTestId('abnormal-results')).toContainText('obs-critical-1:critical-high');
  });

  test('abnormal-result-unlatched has no follow-up until confirmation', async ({ page }) => {
    await openHarness(page);
    await page.getByTestId('refresh-reads').click();
    await expect(page.getByTestId('abnormal-results')).toContainText('obs-1:high');
    await expect(page.getByTestId('followup-list')).toHaveText('');
  });

  test('human-confirm-followup writes once from a visible click', async ({ page }) => {
    await openHarness(page);
    await page.getByTestId('stage-followup').click();
    expect(await page.evaluate(() => window.__harness.writeMethods())).toEqual([]);
    await page.getByTestId('confirm-followup').click();
    await expect.poll(() => page.evaluate(() => window.__harness.createdCount())).toBe(1);
    expect(await page.evaluate(() => window.__harness.carePlanPosts())).toHaveLength(1);
  });

  test('draft-stages-without-write stages from the UI with no network write', async ({ page }) => {
    await openHarness(page);
    await page.getByTestId('stage-followup').click();
    await expect(page.getByTestId('review-item')).toHaveCount(1);
    expect(await page.evaluate(() => window.__harness.writeMethods())).toEqual([]);
    expect(await page.evaluate(() => window.__harness.createdCount())).toBe(0);
  });

  test('confirm-requires-visible-click does not create a task from staging alone', async ({ page }) => {
    await openHarness(page);
    await page.getByTestId('stage-followup').click();
    await page.evaluate((input) => window.__harness.invoke('stage_followup_task', input), SYNTHETIC_DRAFT);
    expect(await page.evaluate(() => window.__harness.createdCount())).toBe(0);
    expect(await page.evaluate(() => window.__harness.writeMethods())).toEqual([]);
  });
});

async function openHarness(page: Page): Promise<void> {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => window.__harness.toolNames().length)).toBeGreaterThan(0);
}
