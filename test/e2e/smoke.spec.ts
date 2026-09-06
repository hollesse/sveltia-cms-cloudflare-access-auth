import { test, expect } from '@playwright/test';

/**
 * Harness-Smoke: bestätigt, dass Chromium startet, `setContent` Inline-Scripts
 * ausführt, und dass ein kaputtes Script als `pageerror` sichtbar wird — die
 * Grundlage des Client-JS-Guards.
 */
test('clean inline script runs without a pageerror', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.setContent('<!doctype html><html><body><script>window.__ok = 41 + 1;</script></body></html>');

  expect(await page.evaluate('window.__ok')).toBe(42);
  expect(errors).toEqual([]);
});

test('a broken inline script surfaces as a pageerror (guard sanity)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.setContent('<!doctype html><html><body><script>function(</script></body></html>');
  await page.waitForTimeout(50);

  expect(errors.length).toBeGreaterThan(0);
});
