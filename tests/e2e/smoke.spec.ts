import { test, expect } from '@playwright/test';

test('sample page can host a video element', async ({ page }) => {
  await page.setContent(`
    <!doctype html>
    <video width="320" height="180" controls muted></video>
  `);

  await expect(page.locator('video')).toBeVisible();
});
