import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyAuthorization } from '../../src/github.js';
import type { TokenStore } from '../../src/token-store.js';
import { pickTexts } from '../../src/texts.js';
import type { Env } from '../../src/types.js';
import { signTestAccessJwt } from '../helpers/access-identity.js';
import { connectBot } from '../helpers/device-flow.js';

/**
 * Setup-Konto-Verifikation: nach dem Device Flow wird das
 * autorisierte GitHub-Konto per `GET /user` verifiziert (welches Konto? wie
 * viele erreichbare App-Installationen?) BEVOR gespeichert wird. Schlägt die
 * Verifikation fehl (ungültiges Token), wird die Autorisierung NICHT gespeichert.
 */
const testEnv = env as unknown as Env;

const ISSUER = 'https://team.cloudflareaccess.com';
const AUD = 'aud-value';
const ORIGIN = 'https://worker.example.com';
const ADMIN = 'admin@example.com';

let originalEnv: Env;

const bot = () => testEnv.TOKEN_STORE.get(testEnv.TOKEN_STORE.idFromName('bot'));
const jsonHeaders = async () => ({
  'Cf-Access-Jwt-Assertion': await signTestAccessJwt(AUD, ISSUER, { email: ADMIN }),
  origin: ORIGIN,
  'content-type': 'application/json',
});

beforeEach(async () => {
  originalEnv = { ...testEnv };
  Object.assign(testEnv, {
    GITHUB_APP_CLIENT_ID: 'Iv1.testclientid',
    ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
    ACCESS_APP_AUD: AUD,
    ALLOWED_DOMAINS: 'cms.example.com',
    GITHUB_AUTH_URL: '',
    SETUP_ADMINS: ADMIN,
  });
  await runInDurableObject(bot(), async (_instance: TokenStore, state) => state.storage.deleteAll());
});

afterEach(() => {
  Object.keys(testEnv).forEach((key) => delete (testEnv as unknown as Record<string, unknown>)[key]);
  Object.assign(testEnv, originalEnv);
});

describe('verifyAuthorization', () => {
  it('returns the account login, accountId and reachable installation count', async () => {
    const result = await verifyAuthorization('ghu_ok');
    expect(result).toMatchObject({ ok: true, login: 'myclub-cms-bot', accountId: 4242, installations: 1 });
  });

  it('fails for an invalid token', async () => {
    const result = await verifyAuthorization('ghu_bad');
    expect(result.ok).toBe(false);
  });

  // Reaudit R5 (auth-p6d2c): eine fehlschlagende Installations-Abfrage ist
  // NICHT dasselbe wie "wirklich 0 Installationen" — `GET /user` bleibt
  // gueltig, nur `GET /user/installations` schlaegt fehl (Mock: 5xx).
  it('reports installations as null (unknown) when the installations query fails, not 0', async () => {
    const result = await verifyAuthorization('ghu_installations_down');
    expect(result).toMatchObject({ ok: true, login: 'myclub-cms-bot', installations: null });
  });
});

describe('device-flow poll verifies the account before storing', () => {
  it('stores the verified account and shows it on the dashboard', async () => {
    const response = await connectBot(ORIGIN, await jsonHeaders());
    expect(response.status).toBe(200);

    const status = await bot().status();
    expect(status.authorized).toBe(true);
    expect(status.account?.login).toBe('myclub-cms-bot');

    const dashboard = await SELF.fetch(`${ORIGIN}/setup`, {
      headers: { 'Cf-Access-Jwt-Assertion': await signTestAccessJwt(AUD, ISSUER, { email: ADMIN }) },
    });
    expect(await dashboard.text()).toContain('myclub-cms-bot');
  });

  it('does NOT store when account verification fails (invalid token)', async () => {
    testEnv.GITHUB_APP_CLIENT_ID = 'client-badaccount';

    const response = await connectBot(ORIGIN, await jsonHeaders());
    expect(response.status).toBe(502);

    const status = await bot().status();
    expect(status.authorized).toBe(false);
    expect(status.account).toBeNull();
  });

  it('shows the accountId and "unknown" instead of "0" when the installations query failed', async () => {
    testEnv.GITHUB_APP_CLIENT_ID = 'client-installationsdown';

    const response = await connectBot(ORIGIN, await jsonHeaders());
    expect(response.status).toBe(200);

    const status = await bot().status();
    expect(status.account).toMatchObject({ login: 'myclub-cms-bot', accountId: 4242, installations: null });

    const dashboard = await SELF.fetch(`${ORIGIN}/setup`, {
      headers: { 'Cf-Access-Jwt-Assertion': await signTestAccessJwt(AUD, ISSUER, { email: ADMIN }) },
    });
    const html = await dashboard.text();
    expect(html).toContain('4242');
    expect(html).not.toContain('0 erreichbare');
  });
});

describe('device-flow poll pins the connected account (Reaudit R5, auth-p6d2c)', () => {
  it('rejects a reconnect (no disconnect) that verifies as a DIFFERENT account, keeping the original account and token bound', async () => {
    const first = await connectBot(ORIGIN, await jsonHeaders());
    expect(first.status).toBe(200);

    const afterFirst = await bot().status();
    expect(afterFirst.account?.login).toBe('myclub-cms-bot');
    const originalToken = afterFirst.accessToken;

    // Reconnect ohne Disconnect: dieselbe Admin-Session startet einen neuen
    // Device Flow, der aber mit einem ANDEREN GitHub-Konto abschliesst.
    testEnv.GITHUB_APP_CLIENT_ID = 'client-otheraccount';
    const second = await connectBot(ORIGIN, await jsonHeaders());

    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ ok: false, reason: 'account_mismatch' });

    const afterSecond = await bot().status();
    expect(afterSecond.account?.login).toBe('myclub-cms-bot');
    expect(afterSecond.accessToken).toBe(originalToken);
  });

  it('shows the account-mismatch rejection reason understandably in the setup UI (de)', async () => {
    const first = await connectBot(ORIGIN, await jsonHeaders());
    expect(first.status).toBe(200);

    testEnv.GITHUB_APP_CLIENT_ID = 'client-otheraccount';
    const second = await connectBot(ORIGIN, await jsonHeaders());
    expect(second.status).toBe(409);

    const dashboard = await SELF.fetch(`${ORIGIN}/setup`, {
      headers: { 'Cf-Access-Jwt-Assertion': await signTestAccessJwt(AUD, ISSUER, { email: ADMIN }) },
    });
    const html = await dashboard.text();
    expect(html).toContain(pickTexts(null).setup.accountMismatch);
  });
});

// Verifier-Fund Iteration 1 (auth-p6d2c): ein VOR diesem Fix gespeichertes
// Konto (kein `accountId`, direkt in den Storage geschrieben — genau der
// Fall, den `completePendingFlow` bewusst defensiv als "kein Pin" behandelt)
// rief `d.accountIdLabel(status.account.accountId)` ohne Guard auf und
// rendere woertlich "Konto-ID undefined". Muss stattdessen als "unbekannt"
// erkennbar sein, nicht als undefined oder eine erfundene Zahl.
describe('dashboard display of a legacy account stored without accountId (Reaudit R5, iteration 2)', () => {
  it('shows neither "undefined" nor a fabricated account ID for a pre-fix legacy account', async () => {
    await runInDurableObject(bot(), async (_instance: TokenStore, state) => {
      await state.storage.put({
        refreshToken: 'refresh-legacy',
        accessToken: 'ghu_legacy',
        expiresAt: Date.now() + 3_600_000,
        'account:v1': { login: 'legacy-bot', installations: 2 },
      });
    });

    const dashboard = await SELF.fetch(`${ORIGIN}/setup`, {
      headers: { 'Cf-Access-Jwt-Assertion': await signTestAccessJwt(AUD, ISSUER, { email: ADMIN }) },
    });
    const html = await dashboard.text();

    expect(html).toContain('legacy-bot');
    expect(html).not.toContain('undefined');
    expect(html).not.toMatch(/Konto-ID \d/);
    expect(html).not.toMatch(/Account ID \d/);
  });
});
