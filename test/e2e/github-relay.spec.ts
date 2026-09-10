import { test, expect } from '@playwright/test';
import { loadPagesModule } from './render-pages.mjs';

/**
 * Zwei-Origin-Handshake des GitHub-Delegations-Flows (ADR 0017 +
 * ADR-0017-Nachtrag infrastructure-m4v9k: Ein-Klick-Login, Handshake jetzt in
 * der Auswahl-Seite statt einer eigenen `/auth/github`-Zwischenseite) in
 * echtem Chromium. Drei simulierte Origins per `context.route` (nicht nur
 * `page.route` — die Popup-Fenster muessen die Interception erben, s.
 * Task-Notes):
 *
 *  - `https://cms.test`     — Fake-CMS, reproduziert Sveltias `authorize()`
 *                             (Handler prueft `event.origin` strikt gegen den
 *                             Auswahl-Seiten-Origin).
 *  - `https://worker.test`  — unsere Auswahl-Seite (`renderSelectionPage`,
 *                             die den geteilten Handshake-Baustein einbettet).
 *  - `https://upstream.test` — Stub des `sveltia-cms-auth`-Upstreams,
 *                             reproduziert dessen `outputHTML`-Handshake-Skript
 *                             (Research zwei-origin-handshake-optionen-2026-09-04).
 */
const UPSTREAM_ORIGIN = 'https://upstream.test';
const RELAY_ORIGIN = 'https://worker.test';
const CMS_ORIGIN = 'https://cms.test';
const ATTACKER_ORIGIN = 'https://attacker.test';

async function renderRelayHtml(overrides: {
  upstreamAuthUrl?: string;
  upstreamOrigin?: string;
  timeoutMs?: number;
} = {}): Promise<string> {
  const p = await loadPagesModule();
  const t = p.pickTexts('en');
  const response = p.renderSelectionPage(
    {
      upstreamAuthUrl: overrides.upstreamAuthUrl ?? `${UPSTREAM_ORIGIN}/auth?site_id=cms.test&provider=github`,
      upstreamOrigin: overrides.upstreamOrigin ?? UPSTREAM_ORIGIN,
      allowedDomains: ['cms.test'],
      timeoutMs: overrides.timeoutMs,
    },
    `${RELAY_ORIGIN}/auth/access?site_id=cms.test`,
    'cms.test',
    t,
  );

  return response.text();
}

const CMS_HTML = `<!doctype html>
<html><body>
<button id="startGithub">start</button>
<div id="result"></div>
<div id="error"></div>
<script>
(function () {
  var authOrigin = ${JSON.stringify(RELAY_ORIGIN)};
  var popup;
  document.getElementById('startGithub').addEventListener('click', function () {
    popup = window.open('${RELAY_ORIGIN}/auth?site_id=cms.test');
    window.addEventListener('message', function handler(event) {
      if (event.origin !== authOrigin || typeof event.data !== 'string') { return; }
      if (event.data === 'authorizing:github') {
        event.source.postMessage('authorizing:github', authOrigin);
        return;
      }
      if (event.data.indexOf('authorization:github:success:') === 0) {
        var payload = JSON.parse(event.data.slice('authorization:github:success:'.length));
        document.getElementById('result').textContent = 'token:' + payload.token;
        window.removeEventListener('message', handler);
      }
      if (event.data.indexOf('authorization:github:error:') === 0) {
        document.getElementById('error').textContent = 'error-received';
        window.removeEventListener('message', handler);
      }
    });
  });
})();
</script>
</body></html>`;

/** Stub des `sveltia-cms-auth`-`outputHTML`-Skripts (Research, Findings zu
 * `src/index.js`): pingt den Opener, wartet auf dessen Antwort, sendet dann
 * den Token an genau diesen Origin. */
const UPSTREAM_HTML = `<!doctype html>
<html><body>upstream
<script>
(function () {
  window.opener && window.opener.postMessage('authorizing:github', '*');
  window.addEventListener('message', function (event) {
    if (event.data !== 'authorizing:github') { return; }
    window.opener.postMessage(
      'authorization:github:success:' + JSON.stringify({ provider: 'github', token: 'gh-test-token-123' }),
      event.origin,
    );
  });
})();
</script>
</body></html>`;

/**
 * Deterministic substitute for fixed `waitForTimeout` sleeps. Installed as a
 * context-wide init script (runs before ANY page/popup script, on every
 * navigation in the context — including window.open'd popups), it records
 * every `message` event a window receives into `window.__testMessageProbeCount`.
 * Because this listener is registered before the relay's/CMS's own script
 * runs, and same-target listeners fire synchronously in registration order,
 * observing the counter increment PROVES the corresponding relay/CMS message
 * handler has already finished processing that same event (accept or
 * reject) — there is no in-between state to race against. This only proves
 * "the event was dispatched and fully handled"; it does not by itself prove
 * WHAT the handler decided, which is why callers still assert the resulting
 * DOM state after waiting on the probe.
 */
async function installMessageProbe(context: import('@playwright/test').BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    (window as unknown as { __testMessageProbeCount: number }).__testMessageProbeCount = 0;
    window.addEventListener(
      'message',
      () => {
        (window as unknown as { __testMessageProbeCount: number }).__testMessageProbeCount += 1;
      },
      true,
    );
    // Companion counter for uncaught errors thrown synchronously while a
    // `message` listener registered later (e.g. the relay's own
    // `onUpstreamMessage`) is processing that same message. Needed because
    // some malformed-payload mutations do not leave the DOM unchanged AND
    // silent — they instead throw (e.g. `event.data.indexOf is not a
    // function` when the payload is a non-string object and the relay's own
    // `typeof event.data !== 'string'` guard has been removed). Without this,
    // asserting only on DOM state after `waitForNextMessage` cannot
    // distinguish "guard rejected it cleanly" from "guard missing, handler
    // blew up" — both leave the DOM untouched.
    (window as unknown as { __testErrorCount: number }).__testErrorCount = 0;
    window.addEventListener('error', () => {
      (window as unknown as { __testErrorCount: number }).__testErrorCount += 1;
    });
  });
}

async function probeCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __testMessageProbeCount: number }).__testMessageProbeCount);
}

async function errorCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __testErrorCount: number }).__testErrorCount);
}

async function waitForNextMessage(page: import('@playwright/test').Page, baseline: number): Promise<void> {
  await page.waitForFunction(
    (base) => (window as unknown as { __testMessageProbeCount: number }).__testMessageProbeCount > base,
    baseline,
  );
}

async function registerCommonRoutes(
  context: import('@playwright/test').BrowserContext,
  relayOverrides?: { timeoutMs?: number },
): Promise<void> {
  await context.route(`${CMS_ORIGIN}/**`, (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: CMS_HTML }),
  );
  await context.route(`${RELAY_ORIGIN}/**`, async (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: await renderRelayHtml(relayOverrides) }),
  );
}

test('happy path: full double handshake delivers the token to the fake CMS, the upstream popup is closed by the relay', async ({
  context,
  page,
}) => {
  await registerCommonRoutes(context);
  await context.route(`${UPSTREAM_ORIGIN}/**`, (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: UPSTREAM_HTML }),
  );

  await page.goto(`${CMS_ORIGIN}/`);

  const relayPopupPromise = page.waitForEvent('popup');
  await page.locator('#startGithub').click();
  const relayPopup = await relayPopupPromise;
  await relayPopup.waitForLoadState('load');

  const upstreamPopupPromise = relayPopup.waitForEvent('popup');
  await relayPopup.locator('#start').click();
  const upstreamPopup = await upstreamPopupPromise;
  await upstreamPopup.waitForLoadState('load');

  await expect(page.locator('#result')).toHaveText('token:gh-test-token-123', { timeout: 10_000 });

  // The upstream callback window never closes itself and the CMS only closes
  // its OWN popup (the relay page P) — so the relay must close the upstream
  // window once the result arrived (src/pages.ts finish()). Without that the
  // editor is left staring at a blank upstream tab after every login.
  await expect.poll(() => upstreamPopup.isClosed(), { timeout: 10_000 }).toBe(true);
});

/**
 * Unlike `CMS_HTML`, this fixture deliberately does NOT unsubscribe its
 * message listener after a successful handover: it keeps replying to
 * `authorizing:github` pings and records every delivered token in
 * `#count`/`#result`. That is intentional — it isolates the RELAY's own
 * one-shot guard (`onUpstreamMessage`'s `removeEventListener` at
 * src/pages.ts:596) from the CMS-side one-shot behaviour that `CMS_HTML`
 * also happens to have. If the CMS fixture unsubscribed too, a second
 * handover could be silently absorbed by the CMS side even if the relay's
 * own guard were missing, making the test pass for the wrong reason.
 */
const ONE_SHOT_PROBE_CMS_HTML = `<!doctype html>
<html><body>
<button id="startGithub">start</button>
<div id="result"></div>
<div id="count">0</div>
<script>
(function () {
  var authOrigin = ${JSON.stringify(RELAY_ORIGIN)};
  var count = 0;
  document.getElementById('startGithub').addEventListener('click', function () {
    window.open('${RELAY_ORIGIN}/auth?site_id=cms.test');
    window.addEventListener('message', function (event) {
      if (event.origin !== authOrigin || typeof event.data !== 'string') { return; }
      if (event.data === 'authorizing:github') {
        event.source.postMessage('authorizing:github', authOrigin);
        return;
      }
      if (event.data.indexOf('authorization:github:success:') === 0) {
        var payload = JSON.parse(event.data.slice('authorization:github:success:'.length));
        count += 1;
        document.getElementById('result').textContent = 'token:' + payload.token;
        document.getElementById('count').textContent = String(count);
      }
    });
  });
})();
</script>
</body></html>`;

/**
 * Like `UPSTREAM_HTML`, but sends TWO success messages back-to-back in the
 * same synchronous turn. Since the relay now CLOSES the upstream popup as
 * soon as the first result is accepted (src/pages.ts finish()), a
 * post-handover `upstreamPopup.evaluate(...)` can no longer drive the second
 * message — instead both messages are queued at the relay window before the
 * relay processes either of them, so the second one still deterministically
 * exercises the relay's own one-shot unsubscribe.
 */
const UPSTREAM_DOUBLE_SEND_HTML = `<!doctype html>
<html><body>upstream
<script>
(function () {
  window.opener && window.opener.postMessage('authorizing:github', '*');
  window.addEventListener('message', function (event) {
    if (event.data !== 'authorizing:github') { return; }
    window.opener.postMessage(
      'authorization:github:success:' + JSON.stringify({ provider: 'github', token: 'gh-test-token-123' }),
      event.origin,
    );
    window.opener.postMessage(
      'authorization:github:success:' + JSON.stringify({ provider: 'github', token: 'second-token-must-be-ignored' }),
      event.origin,
    );
  });
})();
</script>
</body></html>`;

test('one-shot: a second success message from the legitimate upstream popup is ignored by the relay', async ({
  context,
  page,
}) => {
  await installMessageProbe(context);
  await context.route(`${CMS_ORIGIN}/**`, (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: ONE_SHOT_PROBE_CMS_HTML }),
  );
  await context.route(`${RELAY_ORIGIN}/**`, async (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: await renderRelayHtml() }),
  );
  await context.route(`${UPSTREAM_ORIGIN}/**`, (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: UPSTREAM_DOUBLE_SEND_HTML }),
  );

  await page.goto(`${CMS_ORIGIN}/`);

  const relayPopupPromise = page.waitForEvent('popup');
  await page.locator('#startGithub').click();
  const relayPopup = await relayPopupPromise;
  await relayPopup.waitForLoadState('load');

  const upstreamPopupPromise = relayPopup.waitForEvent('popup');
  await relayPopup.locator('#start').click();
  const upstreamPopup = await upstreamPopupPromise;
  await upstreamPopup.waitForLoadState('load');

  await expect(page.locator('#result')).toHaveText('token:gh-test-token-123', { timeout: 10_000 });
  await expect(page.locator('#count')).toHaveText('1');

  // The relay's own `onUpstreamMessage` listener removed itself right after
  // the first success (src/pages.ts one-shot unsubscribe). The CMS fixture
  // above keeps listening and would happily accept a second handover — so if
  // the relay forwarded the second (already-queued) success, `#count` would
  // tick to 2 and `#result` would flip.
  //
  // Deterministic sync point: the relay window receives, in order, the
  // upstream ping (1), success #1 (2), success #2 (3) — all queued before the
  // relay's outbound CMS handshake even starts — and the CMS's
  // `authorizing:github` reply (4). Waiting for probe >= 4 therefore proves
  // the second success was already fully processed (accepted or rejected)
  // when we assert the CMS state below, without any wall-clock sleep.
  await relayPopup.waitForFunction(
    () => (window as unknown as { __testMessageProbeCount: number }).__testMessageProbeCount >= 4,
    undefined,
    { timeout: 10_000 },
  );
  await expect(page.locator('#result')).toHaveText('token:gh-test-token-123');
  await expect(page.locator('#count')).toHaveText('1');
});

test('adversarial: a success message from a foreign origin is ignored — no token reaches the CMS', async ({
  context,
  page,
}) => {
  await installMessageProbe(context);
  await registerCommonRoutes(context);
  // Upstream misbehaves/is compromised: instead of the real handshake it
  // navigates its own popup to an attacker-controlled origin and sends the
  // success message from THERE. Same window object (= legitimate `popup`
  // reference on the relay side), but `event.origin` no longer matches the
  // configured upstream origin — the relay must ignore it.
  await context.route(`${UPSTREAM_ORIGIN}/**`, (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><body><script>location.href = ${JSON.stringify(ATTACKER_ORIGIN)} + '/evil';</script></body>`,
    }),
  );
  await context.route(`${ATTACKER_ORIGIN}/**`, (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><body><script>
        window.opener && window.opener.postMessage(
          'authorization:github:success:' + JSON.stringify({ provider: 'github', token: 'stolen-token' }),
          '*',
        );
      </script></body>`,
    }),
  );

  await page.goto(`${CMS_ORIGIN}/`);

  const relayPopupPromise = page.waitForEvent('popup');
  await page.locator('#startGithub').click();
  const relayPopup = await relayPopupPromise;
  await relayPopup.waitForLoadState('load');
  // The malformed (foreign-origin) message is the ONLY message reaching the
  // relay popup in this test, so the baseline can be taken right here.
  const baseline = await probeCount(relayPopup);

  const upstreamPopupPromise = relayPopup.waitForEvent('popup');
  await relayPopup.locator('#start').click();
  const upstreamPopup = await upstreamPopupPromise;
  await upstreamPopup.waitForLoadState('load');
  // Wait for the attacker navigation + message attempt to actually happen.
  await upstreamPopup.waitForURL(`${ATTACKER_ORIGIN}/evil`);
  // Deterministic sentinel: wait for the relay popup's window to have
  // actually received (and, per JS single-threaded event dispatch, fully
  // processed) the foreign-origin message before asserting anything, instead
  // of a fixed sleep.
  await waitForNextMessage(relayPopup, baseline);

  await expect(page.locator('#result')).toHaveText('');
});

test('adversarial: non-string postMessage data is ignored by the relay', async ({ context, page }) => {
  await installMessageProbe(context);
  await registerCommonRoutes(context);
  await context.route(`${UPSTREAM_ORIGIN}/**`, (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><body><script>
        window.opener && window.opener.postMessage({ not: 'a string' }, '*');
      </script></body>`,
    }),
  );

  await page.goto(`${CMS_ORIGIN}/`);

  const relayPopupPromise = page.waitForEvent('popup');
  await page.locator('#startGithub').click();
  const relayPopup = await relayPopupPromise;
  await relayPopup.waitForLoadState('load');
  // The malformed (non-string) message is the ONLY message reaching the
  // relay popup in this test, so the baseline can be taken right here.
  const baseline = await probeCount(relayPopup);

  const upstreamPopupPromise = relayPopup.waitForEvent('popup');
  await relayPopup.locator('#start').click();
  const upstreamPopup = await upstreamPopupPromise;
  await upstreamPopup.waitForLoadState('load');
  // Deterministic sentinel: wait for the relay popup's window to have
  // actually received (and, per JS single-threaded event dispatch, fully
  // processed) the non-string message before asserting anything, instead of
  // a fixed sleep.
  await waitForNextMessage(relayPopup, baseline);

  await expect(page.locator('#result')).toHaveText('');
  // The relay page itself must not have crashed/hung on the malformed data.
  await expect(relayPopup.locator('#start')).toBeVisible();
  // Without the `typeof event.data !== 'string'` guard, the handler still
  // leaves `#result` empty — but only because it throws (uncaught) trying to
  // call `.indexOf` on a plain object, not because it deliberately ignored
  // the payload. `#result` alone can't tell "rejected cleanly" apart from
  // "guard missing, handler blew up" — both leave the DOM untouched. Assert
  // no such uncaught error occurred, which the guard's presence guarantees.
  expect(await errorCount(relayPopup)).toBe(0);
});

/**
 * Unlike `UPSTREAM_HTML`, this stub does NOT auto-fire the ping/success
 * round trip. It only exposes `window.__sendSuccess(token)`, so the test
 * fully controls WHEN the legitimate success message is sent. This removes
 * an ordering race that a self-triggering stub would otherwise introduce:
 * the relay's own one-shot guard (`removeEventListener` at src/pages.ts:596)
 * fires on the FIRST accepted success message, so if the legitimate
 * handshake were left to auto-complete, it could race ahead of (and mask)
 * the decoy — whichever message actually reaches `onUpstreamMessage` first
 * decides the listener's fate, not the source guard under test.
 */
const UPSTREAM_CONTROLLED_HTML = `<!doctype html>
<html><body>upstream
<script>
(function () {
  window.__sendSuccess = function (token) {
    window.opener.postMessage(
      'authorization:github:success:' + JSON.stringify({ provider: 'github', token: token }),
      '*',
    );
  };
})();
</script>
</body></html>`;

test('adversarial: a success message from a different window on the correct upstream origin is ignored', async ({
  context,
  page,
}) => {
  await installMessageProbe(context);
  await context.route(`${CMS_ORIGIN}/**`, (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: CMS_HTML }),
  );
  await context.route(`${RELAY_ORIGIN}/**`, async (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: await renderRelayHtml() }),
  );
  await context.route(`${UPSTREAM_ORIGIN}/**`, (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: UPSTREAM_CONTROLLED_HTML }),
  );
  // A SECOND window — opened directly from the relay popup itself, so its
  // `window.opener` is the relay popup rather than the real upstream popup
  // the relay itself opened — also lives on the configured upstream origin
  // and sends a well-formed success message on load. `event.origin` matches,
  // but `event.source` is not the `popup` the relay opened
  // (src/pages.ts:586) — the relay must ignore it.
  await context.route(`${UPSTREAM_ORIGIN}/decoy`, (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><body><script>
        window.opener && window.opener.postMessage(
          'authorization:github:success:' + JSON.stringify({ provider: 'github', token: 'decoy-token' }),
          '*',
        );
      </script></body>`,
    }),
  );

  await page.goto(`${CMS_ORIGIN}/`);

  const relayPopupPromise = page.waitForEvent('popup');
  await page.locator('#startGithub').click();
  const relayPopup = await relayPopupPromise;
  await relayPopup.waitForLoadState('load');

  const upstreamPopupPromise = relayPopup.waitForEvent('popup');
  await relayPopup.locator('#start').click();
  const upstreamPopup = await upstreamPopupPromise;
  await upstreamPopup.waitForLoadState('load');

  // Fire the decoy FIRST, before the legitimate popup has sent anything at
  // all (it never auto-sends — see `UPSTREAM_CONTROLLED_HTML`). This removes
  // any race with the relay's own one-shot unsubscribe, which only fires on
  // an ACCEPTED message.
  const baselineBeforeDecoy = await probeCount(relayPopup);
  const decoyPopupPromise = relayPopup.waitForEvent('popup');
  await relayPopup.evaluate((origin) => {
    window.open(origin + '/decoy');
  }, UPSTREAM_ORIGIN);
  const decoyPopup = await decoyPopupPromise;
  await decoyPopup.waitForLoadState('load');
  // Deterministic sentinel: wait for the relay popup's window to have
  // actually received (and, per JS single-threaded event dispatch, fully
  // processed) the decoy's message before asserting anything, instead of a
  // fixed sleep.
  await waitForNextMessage(relayPopup, baselineBeforeDecoy);

  // Decoy must have been rejected: no token has reached the CMS.
  await expect(page.locator('#result')).toHaveText('');

  // Positive proof the channel is still intact and the guard didn't just
  // break everything: a message from the window the relay ACTUALLY opened
  // must still complete the handshake normally. This also rules out the
  // iteration-2 defect where "empty result" could mean "nothing happened at
  // all" rather than "the decoy specifically was rejected".
  const baselineBeforeLegit = await probeCount(relayPopup);
  await upstreamPopup.evaluate(() => {
    (window as unknown as { __sendSuccess: (token: string) => void }).__sendSuccess('gh-test-token-123');
  });
  await waitForNextMessage(relayPopup, baselineBeforeLegit);
  await expect(page.locator('#result')).toHaveText('token:gh-test-token-123', { timeout: 10_000 });
});

test('timeout: a silent upstream produces a visible, bilingual-capable error and still hands an error result to the CMS', async ({
  context,
  page,
}) => {
  await registerCommonRoutes(context, { timeoutMs: 200 });
  // Upstream never sends anything — simulates a silently hanging popup.
  await context.route(`${UPSTREAM_ORIGIN}/**`, (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><body>silent</body>' }),
  );

  await page.goto(`${CMS_ORIGIN}/`);
  const relayPopupPromise = page.waitForEvent('popup');
  await page.locator('#startGithub').click();
  const relayPopup = await relayPopupPromise;
  await relayPopup.waitForLoadState('load');

  const upstreamPopupPromise = relayPopup.waitForEvent('popup');
  await relayPopup.locator('#start').click();
  await upstreamPopupPromise;

  await expect(relayPopup.locator('#status')).toBeVisible({ timeout: 5_000 });
  await expect(relayPopup.locator('#status')).toContainText('Timed out');
  await expect(page.locator('#error')).toHaveText('error-received', { timeout: 5_000 });
});

test('missing opener: navigating to the relay page directly (no window.opener) shows a visible error', async ({
  context,
  page,
}) => {
  await registerCommonRoutes(context);

  // Opened directly (address bar / bookmark), not as a popup — no window.opener.
  await page.goto(`${RELAY_ORIGIN}/auth?site_id=cms.test`);
  await page.locator('#start').click();

  await expect(page.locator('#status')).toBeVisible();
  await expect(page.locator('#status')).toContainText('opener');
  await expect(page.locator('#start')).toBeHidden();
});

test('popup blocked: window.open returning null shows a visible, non-hanging error', async ({
  context,
  page,
}) => {
  await registerCommonRoutes(context);

  await page.goto(`${CMS_ORIGIN}/`);
  const relayPopupPromise = page.waitForEvent('popup');
  await page.locator('#startGithub').click();
  const relayPopup = await relayPopupPromise;
  await relayPopup.waitForLoadState('load');

  // Simulate the browser's pop-up blocker.
  await relayPopup.evaluate(() => {
    window.open = () => null;
  });
  await relayPopup.locator('#start').click();

  await expect(relayPopup.locator('#status')).toBeVisible();
  await expect(relayPopup.locator('#status')).toContainText('blocked');
  await expect(relayPopup.locator('#start')).toBeHidden();
});
