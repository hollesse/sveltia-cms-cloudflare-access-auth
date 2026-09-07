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

  test('account menu opens on click, exposes the logout link, and closes on outside click', async ({ page }) => {
    expect(dashboard, 'dashboard page must render').toBeTruthy();
    await serve(page, dashboard!.html, '/setup');

    const menu = page.locator('#usermenu');
    const logout = page.locator('#usermenu a[href="/cdn-cgi/access/logout"]');
    await expect(menu).toBeHidden();

    await page.locator('#usermenuBtn').click();
    await expect(menu).toBeVisible();
    await expect(logout).toBeVisible();
    await expect(page.locator('#usermenuBtn')).toHaveAttribute('aria-expanded', 'true');

    await page.locator('.brand').click();
    await expect(menu).toBeHidden();
  });

  test('login toggle is on by default and confirms before disabling', async ({ page }) => {
    expect(dashboard, 'dashboard page must render').toBeTruthy();
    await serve(page, dashboard!.html, '/setup');

    // The toggle lives in the Settings section — activate it first.
    await page.locator('.navbtn[data-section="settings"]').click();

    const toggle = page.locator('#loginToggle');
    await expect(toggle).toBeChecked();

    let dialogShown = false;
    page.on('dialog', (dialog) => {
      dialogShown = true;
      void dialog.dismiss();
    });
    // The checkbox itself is opacity:0; a real user clicks the visible switch label.
    await page.locator('label.toggle-switch').click();

    // Dismissing the confirm reverts the switch and performs no navigation.
    expect(dialogShown).toBe(true);
    await expect(toggle).toBeChecked();
  });

  test('disabling updates the state in place without a hard reload', async ({ page }) => {
    expect(dashboard, 'dashboard page must render').toBeTruthy();
    await serve(page, dashboard!.html, '/setup');
    // Specific route for the toggle POST, registered after serve() so it wins.
    await page.route('**/setup/login', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, disabled: true }) }),
    );
    await page.locator('.navbtn[data-section="settings"]').click();
    page.on('dialog', (dialog) => void dialog.accept());

    const state = page.locator('#loginToggleState');
    await expect(state).toHaveText('Enabled');

    await page.locator('label.toggle-switch').click();

    // No reload: still on the Settings section, state flipped in place.
    await expect(page.locator('.section[data-section="settings"]')).toHaveClass(/active/);
    await expect(state).toHaveText('Disabled');
    await expect(page.locator('#loginToggle')).not.toBeChecked();
  });

  test('the login hint is a tooltip that appears on hover', async ({ page }) => {
    expect(dashboard, 'dashboard page must render').toBeTruthy();
    await serve(page, dashboard!.html, '/setup');
    await page.locator('.navbtn[data-section="settings"]').click();

    const bubble = page.locator('.infotip-bubble').first();
    await expect(bubble).toBeHidden();
    await page.locator('.infotip').first().hover();
    await expect(bubble).toBeVisible();
  });
});
