import { test, expect } from '@playwright/test';
import { renderAllPages } from './render-pages.mjs';

/**
 * Client-JS-Guard: lädt jede vom Worker gerenderte Seite in echtem Chromium und
 * stellt sicher, dass ihr Inline-JS ohne Fehler lädt und ausführt. Fängt genau
 * die Klasse Fehler, die die Worker-Tests (SELF.fetch, kein Browser) nicht
 * sehen — z. B. Syntaxfehler im generierten Script oder fehlende DOM-Elemente,
 * an die ein Handler gebunden wird.
 *
 * Geladen wird über `route.fulfill` + `goto` auf einen sicheren HTTPS-Origin
 * (nicht `setContent`/`about:blank`), damit `localStorage`-Zugriff (Dashboard,
 * Wizard) nicht fälschlich als Fehler zählt.
 */
const pages = await renderAllPages();

async function serve(page: import('@playwright/test').Page, html: string, path = '/page'): Promise<void> {
  await page.route('https://e2e.test/**', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }),
  );
  await page.goto(`https://e2e.test${path}`);
  await page.waitForLoadState('load');
}

test.describe('rendered pages execute their client JS without error', () => {
  for (const { name, html } of pages) {
    test(name, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(String(error)));

      await serve(page, html);
      await page.waitForTimeout(30);

      expect(errors, `pageerror(s) on "${name}": ${errors.join(' | ')}`).toEqual([]);
    });
  }
});

test.describe('interactive client behaviour', () => {
  const dashboard = pages.find((p) => p.name === 'dashboard [en]');

  test('dashboard sidebar toggle updates the shell and persists to localStorage', async ({ page }) => {
    expect(dashboard, 'dashboard page must render').toBeTruthy();
    await serve(page, dashboard!.html, '/setup');

    const shell = page.locator('#shell');
    await expect(shell).not.toHaveClass(/collapsed/);

    await page.locator('#navtoggle').click();

    await expect(shell).toHaveClass(/collapsed/);
    expect(await page.evaluate(() => localStorage.getItem('sidebarCollapsed'))).toBe('1');
  });
});
