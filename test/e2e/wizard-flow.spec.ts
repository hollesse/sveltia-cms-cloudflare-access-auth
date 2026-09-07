import { test, expect } from '@playwright/test';
import { renderAllPages } from './render-pages.mjs';

/**
 * Klick-Flow: treibt den Wizard im echten Browser durch mehrere Schritte —
 * Bot per Device-Flow verbinden → Domain freischalten — und prüft, dass das
 * Client-JS die richtigen Requests absetzt, die UI aktualisiert (Geräte-Code)
 * und per `location.reload()` in den nächsten Schritt wechselt. GitHub und die
 * Worker-Endpunkte sind stateful gemockt; ausgeliefert werden die ECHTEN
 * gerenderten Wizard-Schritte (reales Client-JS).
 */
const pages = await renderAllPages();
const stepHtml = (n: number): string => {
  const found = pages.find((p) => p.name === `wizard-step-${n} [en]`);
  if (!found) throw new Error(`wizard-step-${n} [en] not rendered`);
  return found.html;
};

test('connect the bot via device flow, then approve a domain', async ({ page }) => {
  let phase: 'connect' | 'domains' | 'authurl' = 'connect';
  const calls: string[] = [];
  let polledTxId: unknown;

  await page.route('https://e2e.test/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });

    if (request.method() === 'GET' && url.pathname === '/setup') {
      const step = phase === 'connect' ? 3 : phase === 'domains' ? 4 : 5;
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: stepHtml(step) });
    }

    calls.push(`${request.method()} ${url.pathname}`);

    if (url.pathname === '/setup/github/start') {
      return json({
        ok: true,
        userCode: 'ABCD-1234',
        verificationUri: 'https://github.com/login/device',
        txId: 'tx-test-1234',
        interval: 1,
      });
    }
    if (url.pathname === '/setup/github/poll') {
      polledTxId = (JSON.parse(request.postData() ?? '{}') as { txId?: unknown }).txId;
      phase = 'domains'; // Zustimmung erfolgt -> nächster GET /setup zeigt Domains-Schritt
      return json({ ok: true });
    }
    if (url.pathname === '/setup/settings') {
      const body = JSON.parse(request.postData() ?? '{}') as { allowedDomains?: string };
      if (typeof body.allowedDomains === 'string') phase = 'authurl';
      return json({ ok: true, settings: {} });
    }
    return route.fulfill({ status: 404, body: '' });
  });

  await page.goto('https://e2e.test/setup');

  // Schritt: Bot verbinden (Device Flow) — Klick startet den Flow.
  await page.locator('#connectstart').click();
  await expect(page.locator('#code')).toHaveText('ABCD-1234');
  await expect(page.locator('#verify')).toHaveAttribute('href', 'https://github.com/login/device');

  // Poll erfolgreich -> location.reload() -> Domains-Schritt erscheint.
  await expect(page.locator('#adddomain')).toBeVisible();

  // Schritt: Website freischalten — Domain eintragen und speichern.
  await page.locator('#domainlist .domain').first().fill('cms.example.com');
  await page.locator('#step3save').click();

  // allowedDomains gespeichert -> reload -> optionaler GitHub-Login-Schritt.
  await expect(page.locator('#authUrl')).toBeVisible();

  expect(calls).toContain('POST /setup/github/start');
  expect(calls).toContain('POST /setup/github/poll');
  expect(calls).toContain('POST /setup/settings');
  // Der Browser reicht nur die opaque txId zurück — nie den rohen device_code.
  expect(polledTxId).toBe('tx-test-1234');
});
