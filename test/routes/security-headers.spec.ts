import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TokenStore } from '../../src/token-store.js';
import type { Env } from '../../src/types.js';
import { signTestAccessJwt } from '../helpers/access-identity.js';

/**
 * Security-Response-Header: token-tragende Antworten sind nicht cachebar
 * (`no-store`), der Adminbereich ist nicht einbettbar (X-Frame-Options / CSP
 * `frame-ancestors`), und `nosniff` / `Referrer-Policy` gelten durchgehend.
 */
const testEnv = env as unknown as Env;

const ISSUER = 'https://team.cloudflareaccess.com';
const AUD = 'aud-value';
const ORIGIN = 'https://worker.example.com';

let originalEnv: Env;

const bot = () => testEnv.TOKEN_STORE.get(testEnv.TOKEN_STORE.idFromName('bot'));
const admin = async () => ({
  'Cf-Access-Jwt-Assertion': await signTestAccessJwt(AUD, ISSUER, { email: 'admin@example.com' }),
});

beforeEach(async () => {
  originalEnv = { ...testEnv };
  Object.assign(testEnv, {
    GITHUB_APP_CLIENT_ID: 'Iv1.testclientid',
    ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
    ACCESS_APP_AUD: AUD,
    ALLOWED_DOMAINS: 'cms.example.com',
    GITHUB_AUTH_URL: '',
    SETUP_ADMINS: 'admin@example.com',
  });
  await runInDurableObject(bot(), async (instance: TokenStore, state) => {
    await state.storage.deleteAll();
    await instance.storeAuthorization({
      accessToken: 'ghu_bot_token',
      expiresAt: Date.now() + 4 * 3600 * 1000,
      refreshToken: 'refresh-ok',
    });
  });
});

afterEach(() => {
  Object.keys(testEnv).forEach((key) => delete (testEnv as unknown as Record<string, unknown>)[key]);
  Object.assign(testEnv, originalEnv);
});

describe('Security response headers', () => {
  it('sets no-store, nosniff and referrer-policy on the token callback page', async () => {
    const response = await SELF.fetch(`${ORIGIN}/auth/access?site_id=cms.example.com`, {
      headers: await admin(),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('ghu_bot_token'); // token page
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('makes the admin dashboard non-embeddable and non-cacheable', async () => {
    const response = await SELF.fetch(`${ORIGIN}/setup`, { headers: await admin() });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('marks the rotate JSON (which carries the token) no-store', async () => {
    const response = await SELF.fetch(`${ORIGIN}/setup/github/rotate`, {
      method: 'POST',
      headers: { ...(await admin()), origin: ORIGIN },
    });

    expect(response.headers.get('cache-control')).toContain('no-store');
  });
});
