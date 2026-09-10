import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TokenStore } from '../../src/token-store.js';
import type { Env } from '../../src/types.js';
import { signTestAccessJwt } from '../helpers/access-identity.js';
import { connectBot } from '../helpers/device-flow.js';

const testEnv = env as unknown as Env;

const ACCESS_TEAM_DOMAIN = 'team.cloudflareaccess.com';
const ISSUER = `https://${ACCESS_TEAM_DOMAIN}`;
const PRESENTED_AUD = 'access-app-aud-from-jwt';

let originalEnv: Env;

/** Der Route-Code adressiert das TokenStore-DO immer per `idFromName('bot')`
 * — Storage ueberlebt in diesem Test-Pool ueber `it`-Bloecke einer Datei
 * hinweg, muss also zwischen Tests explizit geleert werden. */
async function resetBotTokenStore(): Promise<void> {
  const stub = testEnv.TOKEN_STORE.get(testEnv.TOKEN_STORE.idFromName('bot'));

  await runInDurableObject(stub, async (_instance: TokenStore, state) => {
    await state.storage.deleteAll();
  });
}

beforeEach(async () => {
  originalEnv = { ...testEnv };
  await resetBotTokenStore();
});

afterEach(() => {
  Object.keys(testEnv).forEach((key) => {
    delete (testEnv as unknown as Record<string, unknown>)[key];
  });
  Object.assign(testEnv, originalEnv);
});

const adminHeaders = async (aud = PRESENTED_AUD, email = 'admin@example.com') => ({
  'Cf-Access-Jwt-Assertion': await signTestAccessJwt(aud, ISSUER, { email }),
});

/** Minimaler Anker-Env: nur die zwei Vertrauensanker (ADR 0014) — kein
 * `ACCESS_APP_AUD`, keine `GITHUB_APP_CLIENT_ID`, keine `ALLOWED_DOMAINS`. */
function seedFreshDeploymentEnv(): void {
  Object.assign(testEnv, {
    ACCESS_TEAM_DOMAIN,
    SETUP_ADMINS: 'admin@example.com',
    ACCESS_APP_AUD: '',
    GITHUB_APP_CLIENT_ID: '',
    ALLOWED_DOMAINS: '',
    GITHUB_AUTH_URL: '',
    MANAGE_USERS_URL: '',
  });
}

describe('GET /setup — wizard vs. dashboard (ADR 0014)', () => {
  it('shows step 1 (App festlegen) on a fresh deployment, presenting the JWT aud (TOFU)', async () => {
    seedFreshDeploymentEnv();

    const response = await SELF.fetch('https://worker.example.com/setup', {
      headers: await adminHeaders(),
    });

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('App festlegen');
    expect(body).toContain(PRESENTED_AUD);
  });

  it('shows the dashboard directly for an existing deployment (all values via env fallback)', async () => {
    Object.assign(testEnv, {
      ACCESS_TEAM_DOMAIN,
      SETUP_ADMINS: 'admin@example.com',
      ACCESS_APP_AUD: PRESENTED_AUD,
      GITHUB_APP_CLIENT_ID: 'Iv1.testclientid',
      ALLOWED_DOMAINS: 'cms.example.com',
      GITHUB_AUTH_URL: '',
      MANAGE_USERS_URL: '',
    });

    const connected = await connectBot('https://worker.example.com', await adminHeaders());
    expect((await connected.json() as { ok: boolean }).ok).toBe(true);

    const response = await SELF.fetch('https://worker.example.com/setup', {
      headers: await adminHeaders(),
    });

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('Sveltia CMS Cloudflare Access');
    // Token maskiert (nicht im Klartext), aber per data-token fuer den
    // Auge-Toggle vorhanden; Gueltig-bis + naechste Rotation als localtime-Spans.
    expect(body).toContain('id="tokenval"');
    expect(body).toContain('data-token="ghu_device_token"');
    expect(body).not.toMatch(/>ghu_device_token</);
    expect(body).toContain('id="tokentoggle"');
    expect(body.match(/class="localtime"/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(body).toContain('GitHub-Verbindung');
    expect(body).not.toContain('App festlegen');
  });
});

describe('Dashboard-Einstellungen — Pro-Wert-Formulare statt window.prompt() (Verifier-Fix)', () => {
  it('renders per-value edit forms; the accessAppAud form submits exactly the server-presented JWT aud (no free text)', async () => {
    Object.assign(testEnv, {
      ACCESS_TEAM_DOMAIN,
      SETUP_ADMINS: 'admin@example.com',
      ACCESS_APP_AUD: PRESENTED_AUD,
      GITHUB_APP_CLIENT_ID: 'Iv1.testclientid',
      ALLOWED_DOMAINS: 'cms.example.com',
      GITHUB_AUTH_URL: '',
      MANAGE_USERS_URL: '',
    });

    await connectBot('https://worker.example.com', await adminHeaders());

    const dashboard = await SELF.fetch('https://worker.example.com/setup', {
      headers: await adminHeaders(),
    });
    const html = await dashboard.text();

    // Kein window.prompt() mehr fuer das Einstellungen-Editieren.
    expect(html).not.toMatch(/\bprompt\(/);
    expect(html).toMatch(/<form class="editform" data-field="accessAppAud"/);

    // Sonderfall accessAppAud: KEIN Freitext-Input — das Formular zeigt/
    // uebermittelt exakt das server-praesentierte JWT-aud.
    const audFormMatch = html.match(/<form class="editform" data-field="accessAppAud"[\s\S]*?<\/form>/);
    expect(audFormMatch).toBeTruthy();
    const audForm = audFormMatch![0];
    expect(audForm).toContain(`value="${PRESENTED_AUD}"`);
    expect(audForm).not.toMatch(/type="text"/);

    // Das Formular nutzt den bestehenden /setup/settings-Endpunkt (aus dem
    // gerenderten Markup extrahiert statt hartkodiert) und funktioniert.
    const settingsUrl = [...html.matchAll(/fetch\('([^']+)'/g)]
      .map((m) => m[1])
      .filter((u): u is string => u !== undefined)
      .find((u) => u.endsWith('/setup/settings'));
    expect(settingsUrl).toBeDefined();

    const resetResponse = await SELF.fetch(new URL(settingsUrl!, 'https://worker.example.com'), {
      method: 'POST',
      headers: { ...(await adminHeaders()), 'content-type': 'application/json' },
      body: JSON.stringify({ accessAppAud: PRESENTED_AUD }),
    });

    expect(resetResponse.status).toBe(200);
  });
});

describe('POST /setup/settings — AUD-TOFU pinning (ADR 0014)', () => {
  beforeEach(() => {
    seedFreshDeploymentEnv();
  });

  it('rejects pinning an aud that does not match the currently validated JWT', async () => {
    const response = await SELF.fetch('https://worker.example.com/setup/settings', {
      method: 'POST',
      headers: { ...(await adminHeaders()), 'content-type': 'application/json' },
      body: JSON.stringify({ accessAppAud: 'a-different-app-aud' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, reason: 'invalid_aud' });
  });

  it('pins exactly the presented aud, then enforces it on every subsequent request', async () => {
    const pin = await SELF.fetch('https://worker.example.com/setup/settings', {
      method: 'POST',
      headers: { ...(await adminHeaders()), 'content-type': 'application/json' },
      body: JSON.stringify({ accessAppAud: PRESENTED_AUD }),
    });

    expect(pin.status).toBe(200);
    expect((await pin.json()) as { ok: boolean }).toMatchObject({ ok: true });

    // Nach dem Pinning zeigt /setup Schritt 2 (GitHub App / Client-ID).
    const afterPin = await SELF.fetch('https://worker.example.com/setup', {
      headers: await adminHeaders(),
    });
    expect(await afterPin.text()).toContain('id="cid"');

    // Ein JWT mit abweichendem aud wird jetzt ueberall abgelehnt — auch bei Setup-Routen.
    const wrongAudResponse = await SELF.fetch('https://worker.example.com/setup', {
      headers: await adminHeaders('some-other-app-aud'),
    });
    expect(wrongAudResponse.status).toBe(401);
  });
});

describe('POST /setup/settings — Validierung (ADR 0014)', () => {
  beforeEach(() => {
    seedFreshDeploymentEnv();
  });

  it('rejects a blank githubAppClientId', async () => {
    const response = await SELF.fetch('https://worker.example.com/setup/settings', {
      method: 'POST',
      headers: { ...(await adminHeaders()), 'content-type': 'application/json' },
      body: JSON.stringify({ githubAppClientId: '   ' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, reason: 'invalid_client_id' });
  });

  it('rejects an allowedDomains entry with a scheme/path (hostname-only validation)', async () => {
    const response = await SELF.fetch('https://worker.example.com/setup/settings', {
      method: 'POST',
      headers: { ...(await adminHeaders()), 'content-type': 'application/json' },
      body: JSON.stringify({ allowedDomains: 'cms.example.com, https://bad.example.com' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      reason: 'invalid_domain',
      domain: 'https://bad.example.com',
    });
  });

  it('rejects an empty allowedDomains list', async () => {
    const response = await SELF.fetch('https://worker.example.com/setup/settings', {
      method: 'POST',
      headers: { ...(await adminHeaders()), 'content-type': 'application/json' },
      body: JSON.stringify({ allowedDomains: '   ' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, reason: 'empty_domains' });
  });

  it('rejects a non-https githubAuthUrl', async () => {
    const response = await SELF.fetch('https://worker.example.com/setup/settings', {
      method: 'POST',
      headers: { ...(await adminHeaders()), 'content-type': 'application/json' },
      body: JSON.stringify({ githubAuthUrl: 'http://auth.example.net' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, reason: 'invalid_url' });
  });

  it('accepts skipping an optional step', async () => {
    const response = await SELF.fetch('https://worker.example.com/setup/settings', {
      method: 'POST',
      headers: { ...(await adminHeaders()), 'content-type': 'application/json' },
      body: JSON.stringify({ skipGithubAuthUrl: true }),
    });

    expect(response.status).toBe(200);
    expect(((await response.json()) as { settings: { githubAuthUrlSkipped: boolean } }).settings)
      .toMatchObject({ githubAuthUrlSkipped: true });
  });
});

describe('Vollstaendiger Wizard-Durchlauf (Acceptance Criterion: frisches Deployment)', () => {
  it('walks through app-pin, GitHub connect, and domain approval, after which /auth/access works', async () => {
    seedFreshDeploymentEnv();
    const headers = { ...(await adminHeaders()), 'content-type': 'application/json' };

    // Schritt 1: AUD pinnen.
    await SELF.fetch('https://worker.example.com/setup/settings', {
      method: 'POST',
      headers,
      body: JSON.stringify({ accessAppAud: PRESENTED_AUD }),
    });

    // Schritt 2: Client-ID speichern, Device Flow durchlaufen.
    await SELF.fetch('https://worker.example.com/setup/settings', {
      method: 'POST',
      headers,
      body: JSON.stringify({ githubAppClientId: 'Iv1.testclientid' }),
    });
    await connectBot('https://worker.example.com', await adminHeaders());

    // Schritt 3: Website freischalten.
    await SELF.fetch('https://worker.example.com/setup/settings', {
      method: 'POST',
      headers,
      body: JSON.stringify({ allowedDomains: 'cms.example.com' }),
    });

    // Jetzt zeigt /setup das Dashboard.
    const dashboard = await SELF.fetch('https://worker.example.com/setup', {
      headers: await adminHeaders(),
    });
    expect(await dashboard.text()).toContain('Sveltia CMS Cloudflare Access');

    // Und der E-Mail-Login funktioniert (End-to-End ueber SELF.fetch, gemockte Upstreams).
    const userToken = await signTestAccessJwt(PRESENTED_AUD, ISSUER, {
      email: 'nutzerin@example.com',
    });

    const login = await SELF.fetch(
      'https://worker.example.com/auth/access?site_id=cms.example.com',
      { headers: { 'Cf-Access-Jwt-Assertion': userToken } },
    );

    expect(login.status).toBe(200);
    const body = await login.text();
    expect(body).toContain("':success:'");
  });
});

describe('Wizard Schritt 2 — Device Flow laeuft INLINE auf der Seite (Verifier-Fix)', () => {
  it('drives the split steps 2+3 via the rendered wizard markup (save client ID, then connect bot), then advances to the domains step', async () => {
    seedFreshDeploymentEnv();
    const headers = { ...(await adminHeaders()), 'content-type': 'application/json' };

    // Vorbedingung: Schritt 1 (AUD pinnen) erledigt.
    await SELF.fetch('https://worker.example.com/setup/settings', {
      method: 'POST',
      headers,
      body: JSON.stringify({ accessAppAud: PRESENTED_AUD }),
    });

    // Schritt 2: nur Client-ID speichern (eigener Schritt, User-Feedback).
    const step2Page = await SELF.fetch('https://worker.example.com/setup', {
      headers: await adminHeaders(),
    });
    const step2Html = await step2Page.text();
    expect(step2Html).toMatch(/id="cid"/);
    // Schritt 2 darf den Device Flow NICHT mehr enthalten (getrennte Schritte).
    expect(step2Html).not.toContain('/setup/github/start');

    const step2Calls = [...step2Html.matchAll(/fetch\('([^']+)'/g)]
      .map((m) => m[1])
      .filter((u): u is string => u !== undefined);
    const settingsUrl = step2Calls.find((u) => u.endsWith('/setup/settings'));
    expect(settingsUrl, 'step 2 must POST the client ID via /setup/settings').toBeDefined();

    await SELF.fetch(new URL(settingsUrl!, 'https://worker.example.com'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ githubAppClientId: 'Iv1.testclientid' }),
    });

    // Schritt 3: Bot verbinden — Device Flow inline im gerenderten Markup.
    const step3Page = await SELF.fetch('https://worker.example.com/setup', {
      headers: await adminHeaders(),
    });
    const step3Html = await step3Page.text();
    expect(step3Html).not.toMatch(/id="cid"/);
    expect(step3Html).toMatch(/id="connectstart"/);
    expect(step3Html).toMatch(/<div id="flow" hidden>/);

    const step3Calls = [...step3Html.matchAll(/fetch\('([^']+)'/g)]
      .map((m) => m[1])
      .filter((u): u is string => u !== undefined);
    const startUrl = step3Calls.find((u) => u.endsWith('/setup/github/start'));
    const pollUrl = step3Calls.find((u) => u.endsWith('/setup/github/poll'));

    expect(startUrl, 'step 3 must start the device flow inline (no dead end)').toBeDefined();
    expect(pollUrl, 'step 3 must poll the device flow inline (no dead end)').toBeDefined();
    expect(step3Calls.indexOf(startUrl!)).toBeLessThan(step3Calls.indexOf(pollUrl!));

    const startRes = await SELF.fetch(new URL(startUrl!, 'https://worker.example.com'), {
      method: 'POST',
      headers: await adminHeaders(),
    });
    const startBody = (await startRes.json()) as { txId?: string };
    await SELF.fetch(new URL(pollUrl!, 'https://worker.example.com'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ txId: startBody.txId }),
    });

    // Die Zustandsweiche: nach erfolgreichem Poll zeigt /setup Schritt 3.
    const afterFlow = await SELF.fetch('https://worker.example.com/setup', {
      headers: await adminHeaders(),
    });
    const afterHtml = await afterFlow.text();
    // Schritt-3-spezifisches Markup (Domains-Feld) vorhanden, Schritt-2-Feld weg.
    expect(afterHtml).toMatch(/id="domainlist"/);
    expect(afterHtml).not.toMatch(/id="cid"/);
  });
});

describe('GET/POST — Anmeldung ohne bekanntes AUD (ADR 0014)', () => {
  beforeEach(() => {
    seedFreshDeploymentEnv();
  });

  it('/auth/access refuses cleanly (postMessage error, never hangs) when no AUD is known', async () => {
    const token = await signTestAccessJwt(PRESENTED_AUD, ISSUER, { email: 'nutzerin@example.com' });

    const response = await SELF.fetch(
      'https://worker.example.com/auth/access?site_id=cms.example.com',
      { headers: { 'Cf-Access-Jwt-Assertion': token } },
    );

    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).toContain("':error:'");
  });

  it('/auth also refuses via a setup-incomplete page linking to /setup', async () => {
    const response = await SELF.fetch('https://worker.example.com/auth?site_id=cms.example.com');

    expect(response.status).toBe(503);
    expect(await response.text()).toContain('/setup');
  });

  it('does not jump to the dashboard after the mandatory steps — optional steps and finish are shown (fresh setup)', async () => {
    seedFreshDeploymentEnv();
    const headers = { ...(await adminHeaders()), 'content-type': 'application/json' };
    const stub = testEnv.TOKEN_STORE.get(testEnv.TOKEN_STORE.idFromName('bot'));
    await runInDurableObject(stub, (instance: TokenStore) =>
      instance.storeAuthorization({
        accessToken: 'ghu_x', expiresAt: Date.now() + 3600 * 1000, refreshToken: 'refresh-ok',
      }),
    );
    // Pflichtschritte per Settings erledigen (AUD, Client-ID, Domains).
    await SELF.fetch('https://worker.example.com/setup/settings', {
      method: 'POST', headers, body: JSON.stringify({ accessAppAud: PRESENTED_AUD }),
    });
    await SELF.fetch('https://worker.example.com/setup/settings', {
      method: 'POST', headers, body: JSON.stringify({ githubAppClientId: 'Iv1.testclientid' }),
    });
    await SELF.fetch('https://worker.example.com/setup/settings', {
      method: 'POST', headers, body: JSON.stringify({ allowedDomains: 'cms.example.com' }),
    });
    // Trotz erfüllter Pflichtwerte + verbundenem Bot: noch KEIN Dashboard,
    // sondern der optionale GitHub-Login-Schritt (Wizard nicht abgeschlossen).
    const afterMandatory = await SELF.fetch('https://worker.example.com/setup', {
      headers: await adminHeaders(),
    });
    const html = await afterMandatory.text();
    expect(html).not.toContain('id="navtoggle"'); // kein Dashboard
    expect(html).toContain('id="authUrl"');       // optionaler Schritt 5

    // Fertig-Flag setzen → jetzt Dashboard.
    await SELF.fetch('https://worker.example.com/setup/settings', {
      method: 'POST', headers, body: JSON.stringify({ skipGithubAuthUrl: true }),
    });
    await SELF.fetch('https://worker.example.com/setup/settings', {
      method: 'POST', headers, body: JSON.stringify({ skipManageUsersUrl: true }),
    });
    await SELF.fetch('https://worker.example.com/setup/settings', {
      method: 'POST', headers, body: JSON.stringify({ finishWizard: true }),
    });
    const dash = await SELF.fetch('https://worker.example.com/setup', { headers: await adminHeaders() });
    expect(await dash.text()).toContain('id="navtoggle"');
  });

  it('records user logins (first/last seen) and lists them on the dashboard, admin-gated clear works', async () => {
    seedFreshDeploymentEnv();
    const stub = testEnv.TOKEN_STORE.get(testEnv.TOKEN_STORE.idFromName('bot'));
    await runInDurableObject(stub, (instance: TokenStore) =>
      instance.storeAuthorization({
        accessToken: 'ghu_bot', expiresAt: Date.now() + 4 * 3600 * 1000, refreshToken: 'refresh-ok',
      }),
    );
    // Vollstaendige Konfiguration (Anker via env, Rest wie im Migrations-Test).
    Object.assign(testEnv, { ACCESS_APP_AUD: PRESENTED_AUD, GITHUB_APP_CLIENT_ID: 'Iv1.x', ALLOWED_DOMAINS: 'cms.example.com' });

    // Ein Nutzer meldet sich an → Login wird vermerkt.
    const jwt = await signTestAccessJwt(PRESENTED_AUD, ISSUER, { email: 'nutzerin@example.com' });
    const login = await SELF.fetch('https://worker.example.com/auth/access?site_id=cms.example.com', {
      headers: { 'Cf-Access-Jwt-Assertion': jwt },
    });
    expect(login.status).toBe(200);

    // Dashboard zeigt den Benutzer im Anmeldeverlauf.
    const dash = await SELF.fetch('https://worker.example.com/setup', { headers: await adminHeaders() });
    const html = await dash.text();
    expect(html).toContain('nutzerin@example.com');
    expect(html).toContain('id="clearUsersBtn"');
    expect(html.match(/class="localtime"/g)?.length ?? 0).toBeGreaterThanOrEqual(4); // Token-Zeiten + 2 User-Zeiten

    // Einzelnen Benutzer aus dem Verlauf loeschen (admin-gated).
    const delOne = await SELF.fetch('https://worker.example.com/setup/users/delete', {
      method: 'POST',
      headers: { ...(await adminHeaders()), 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'nutzerin@example.com' }),
    });
    expect(delOne.status).toBe(200);
    const afterDel = await runInDurableObject(stub, (instance: TokenStore) => instance.listUsers());
    expect(afterDel.some((u) => u.email === 'nutzerin@example.com')).toBe(false);

    // Gesamten Verlauf loeschen (admin-gated).
    const cleared = await SELF.fetch('https://worker.example.com/setup/users/clear', {
      method: 'POST', headers: await adminHeaders(),
    });
    expect(cleared.status).toBe(200);
    const empty = await runInDurableObject(stub, (instance: TokenStore) => instance.listUsers());
    expect(empty.length).toBe(0);
  });
});

describe('Client-ID-Wechsel entwertet die gespeicherte Autorisierung (auth-g5h9j, R3d)', () => {
  it('invalidates a previously connected bot token when the GitHub App client ID changes', async () => {
    seedFreshDeploymentEnv();
    const headers = { ...(await adminHeaders()), 'content-type': 'application/json' };

    await SELF.fetch('https://worker.example.com/setup/settings', {
      method: 'POST', headers, body: JSON.stringify({ accessAppAud: PRESENTED_AUD }),
    });
    await SELF.fetch('https://worker.example.com/setup/settings', {
      method: 'POST', headers, body: JSON.stringify({ githubAppClientId: 'client-app-a' }),
    });
    const connected = await connectBot('https://worker.example.com', await adminHeaders());
    expect(connected.status).toBe(200);
    expect(await connected.json()).toEqual({ ok: true });

    // Ein zweiter Device Flow laeuft noch (nicht abgeschlossen), waehrend der
    // Client-ID-Wechsel passiert — er darf danach nicht mehr abschliessbar sein
    // (auth-g5h9j, R3d deckt bisher nur die Autorisierung ab, nicht den Pending-Flow).
    const secondStart = await SELF.fetch('https://worker.example.com/setup/github/start', {
      method: 'POST', headers: await adminHeaders(),
    });
    const { txId: staleTxId } = (await secondStart.json()) as { txId: string };
    expect(staleTxId).toBeTypeOf('string');

    const stub = testEnv.TOKEN_STORE.get(testEnv.TOKEN_STORE.idFromName('bot'));
    expect(await runInDurableObject(stub, (instance: TokenStore) => instance.getPendingFlow())).not.toBeNull();

    // Client-ID-Wechsel: andere GitHub App gespeichert.
    const changed = await SELF.fetch('https://worker.example.com/setup/settings', {
      method: 'POST', headers, body: JSON.stringify({ githubAppClientId: 'client-app-b' }),
    });
    expect(changed.status).toBe(200);

    // Der Pending-Flow der alten App wurde mit entwertet, nicht nur die
    // gespeicherte Autorisierung.
    expect(await runInDurableObject(stub, (instance: TokenStore) => instance.getPendingFlow())).toBeNull();

    const staleFlowPoll = await SELF.fetch('https://worker.example.com/setup/github/poll', {
      method: 'POST', headers, body: JSON.stringify({ txId: staleTxId }),
    });
    expect(staleFlowPoll.status).toBe(400);
    expect(await staleFlowPoll.json()).toMatchObject({ ok: false, reason: 'unknown_transaction' });

    await SELF.fetch('https://worker.example.com/setup/settings', {
      method: 'POST', headers, body: JSON.stringify({ allowedDomains: 'cms.example.com' }),
    });

    const userToken = await signTestAccessJwt(PRESENTED_AUD, ISSUER, {
      email: 'nutzerin@example.com',
    });
    const login = await SELF.fetch(
      'https://worker.example.com/auth/access?site_id=cms.example.com',
      { headers: { 'Cf-Access-Jwt-Assertion': userToken } },
    );

    // Kein Token der alten App B — die Autorisierung wurde beim Wechsel entwertet.
    expect(login.status).toBe(502);
    expect(await login.text()).toContain('nicht mit GitHub verbunden');
  });
});
