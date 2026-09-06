import { defineConfig } from '@playwright/test';

/**
 * Browser-E2E-Guard: laedt die vom Worker gerenderten Seiten in echtem Chromium
 * und fuehrt ihr Client-JS aus — faengt Syntax-/Ladefehler und DOM-Verdrahtung,
 * die die Worker-Tests (SELF.fetch, kein Browser) nicht sehen. Getrennt von
 * Vitest (das den `test/e2e/`-Ordner ignoriert).
 *
 * `channel: 'chrome'` nutzt das installierte Google Chrome statt eines
 * gebundelten Downloads — in CI via `npx playwright install --with-deps chrome`.
 */
export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'line',
  use: {
    channel: 'chrome',
    headless: true,
  },
});
