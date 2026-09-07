import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyAuthorization } from '../../src/github.js';
import type { TokenStore } from '../../src/token-store.js';
import type { Env } from '../../src/types.js';
import { signTestAccessJwt } from '../helpers/access-identity.js';

/**
 * Setup-Konto-Verifikation (auth-v8n3c): nach dem Device Flow wird das
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
const poll = (deviceCode: string) =>
  jsonHeaders().then((headers) =>
    SELF.fetch(`${ORIGIN}/setup/github/poll`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ deviceCode }),
    }),
  );

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
  it('returns the account login and reachable installation count', async () => {
    const result = await verifyAuthorization('ghu_ok');
    expect(result).toMatchObject({ ok: true, login: 'myclub-cms-bot', installations: 1 });
  });

  it('fails for an invalid token', async () => {
    const result = await verifyAuthorization('ghu_bad');
    expect(result.ok).toBe(false);
  });
});

describe('device-flow poll verifies the account before storing', () => {
  it('stores the verified account and shows it on the dashboard', async () => {
    const response = await poll('device-ok');
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
    const response = await poll('device-badaccount');
    expect(response.status).toBe(502);

    const status = await bot().status();
    expect(status.authorized).toBe(false);
    expect(status.account).toBeNull();
  });
});
