import { expect, test, type Page } from '@playwright/test';

const DRAFT = {
  draftId: 'caller-draft-id',
  patient: { id: 'patient-1', display: 'Ada Lovelace' },
  title: 'Follow up potassium',
  rationale: 'Repeat the BMP in clinic after the high potassium result.',
  priority: 'high',
  dueAt: '2026-09-01T09:00:00.000Z',
  assignee: { id: 'person-dr-chen', display: 'Dr. Chen', type: 'person' },
  sourceReference: 'Observation/obs-1',
};

test.describe('draft confirmation harness', () => {
  test('draft staging performs zero write requests', async ({ page }) => {
    await page.goto('/');
    await waitForTools(page);

    const staged = await page.evaluate((input) => window.__harness.invoke('stage_followup_task', input), DRAFT);

    expect(staged.ok).toBe(true);
    expect(staged.data).toEqual({ draftId: expect.any(String) });
    expect((staged.data as { draftId: string }).draftId).not.toBe('caller-draft-id');
    expect(await page.evaluate(() => window.__harness.writeMethods())).toEqual([]);
    await expect(page.getByTestId('review-item-patient')).toHaveText('Ada Lovelace (patient-1)');
    await expect(page.getByTestId('confirm-followup')).toBeEnabled();
  });

  test('visible confirmation click performs exactly one POST to careplan', async ({ page }) => {
    await page.goto('/');
    await waitForTools(page);
    await page.evaluate((input) => window.__harness.invoke('stage_followup_task', input), DRAFT);
    expect(await page.evaluate(() => window.__harness.writeMethods())).toEqual([]);

    await expect(page.getByTestId('confirm-followup')).toBeEnabled();
    await page.getByTestId('confirm-followup').click();

    await expect.poll(() => page.evaluate(() => window.__harness.createdCount())).toBe(1);
    await expect(page.getByTestId('confirm-followup')).toHaveAttribute('data-confirmation-state', 'succeeded');
    expect(await page.evaluate(() => window.__harness.carePlanPosts())).toEqual([
      { method: 'POST', url: '/ws/rest/v1/tasks/careplan' },
    ]);
    expect(await page.evaluate(() => window.__harness.writeMethods())).toEqual(['POST']);
  });

  test('duplicate confirmation cannot create a second task', async ({ page }) => {
    await page.goto('/');
    await waitForTools(page);
    await page.evaluate((input) => window.__harness.invoke('stage_followup_task', input), DRAFT);
    await expect(page.getByTestId('confirm-followup')).toBeEnabled();

    const button = page.getByTestId('confirm-followup');
    await button.click();
    await button.click({ force: true });

    await expect.poll(() => page.evaluate(() => window.__harness.createdCount())).toBe(1);
    await expect(button).toHaveAttribute('data-confirmation-state', 'succeeded');
    expect(await page.evaluate(() => window.__harness.carePlanPosts())).toHaveLength(1);

    const second = await page.evaluate((input) => window.__harness.invoke('stage_followup_task', input), DRAFT);
    expect(second.ok).toBe(true);
    await expect(page.getByTestId('confirm-followup')).toHaveAttribute('data-disabled-reason', 'duplicate-active');
    await page.getByTestId('confirm-followup').click({ force: true });
    expect(await page.evaluate(() => window.__harness.createdCount())).toBe(1);
  });
});

async function waitForTools(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__harness.toolNames().length)).toBeGreaterThan(0);
}
