import { expect, test, type Page } from '@playwright/test';

test.describe('registration lifecycle harness', () => {
  test('lifecycle registers tools on the fake modelContext bridge', async ({ page }) => {
    await page.goto('/');
    await waitForTools(page);

    const names = await page.evaluate(() => window.__harness.toolNames());
    expect(names).toContain('stage_followup_task');
    expect(names).toContain('open_review_queue');
    expect(names).toHaveLength(12);
  });

  test('lifecycle logout aborts registrations and clears drafts', async ({ page }) => {
    await page.goto('/');
    await waitForTools(page);
    await page.evaluate(() =>
      window.__harness.invoke('stage_followup_task', {
        draftId: 'caller',
        patient: { id: 'patient-1', display: 'Ada Lovelace' },
        title: 'Follow up potassium',
        rationale: 'Repeat the BMP in clinic.',
        priority: 'high',
        sourceReference: 'Observation/obs-1',
      }),
    );
    expect(await page.getByTestId('review-item').count()).toBe(1);
    const before = await page.evaluate(() => window.__harness.unregisterCount());

    await page.evaluate(() => window.__harness.logout());

    await expect.poll(() => page.evaluate(() => window.__harness.toolNames())).toEqual([]);
    expect(await page.evaluate(() => window.__harness.unregisterCount())).toBe(before + 12);
    expect(await page.getByTestId('review-item').count()).toBe(0);
  });

  test('lifecycle route change replaces the registered generation', async ({ page }) => {
    await page.goto('/');
    await waitForTools(page);
    const first = await page.evaluate(() => window.__harness.toolNames());
    const before = await page.evaluate(() => window.__harness.unregisterCount());

    await page.evaluate(() => window.__harness.changeRoute('/patient/patient-1/chart'));

    await expect.poll(() => page.evaluate(() => window.__harness.unregisterCount())).toBe(before + 12);
    expect(await page.evaluate(() => window.__harness.toolNames())).toEqual(first);
  });

  test('lifecycle user change replaces registrations and drops prior drafts', async ({ page }) => {
    await page.goto('/');
    await waitForTools(page);
    await page.evaluate(() =>
      window.__harness.invoke('stage_followup_task', {
        draftId: 'caller',
        patient: { id: 'patient-1', display: 'Ada Lovelace' },
        title: 'Follow up potassium',
        rationale: 'Repeat the BMP in clinic.',
        priority: 'high',
        sourceReference: 'Observation/obs-1',
      }),
    );
    const before = await page.evaluate(() => window.__harness.unregisterCount());

    await page.evaluate(() => window.__harness.changeUser('user-2'));

    await expect.poll(() => page.evaluate(() => window.__harness.unregisterCount())).toBe(before + 12);
    expect(await page.evaluate(() => window.__harness.toolNames())).toHaveLength(12);
    expect(await page.getByTestId('review-item').count()).toBe(0);
  });

  test('lifecycle unmount aborts registrations', async ({ page }) => {
    await page.goto('/');
    await waitForTools(page);
    const before = await page.evaluate(() => window.__harness.unregisterCount());

    await page.evaluate(() => window.__harness.unmount());

    expect(await page.evaluate(() => window.__harness.toolNames())).toEqual([]);
    expect(await page.evaluate(() => window.__harness.unregisterCount())).toBe(before + 12);
  });
});

async function waitForTools(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__harness.toolNames().length)).toBeGreaterThan(0);
}
