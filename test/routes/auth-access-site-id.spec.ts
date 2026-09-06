import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TokenStore } from '../../src/token-store.js';
import type { Env } from '../../src/types.js';
import { signTestAccessJwt } from '../helpers/access-identity.js';

/**
 * `/auth/access` soll den `site_id` konsistent zu `/auth` behandeln: ein
 * fehlender `site_id` wird abgelehnt (nicht das Eingangs-Gate überspringen und
 * die Token-Seite ausliefern).
 */
const testEnv = env as unknown as Env;

const ISSUER = 'https://team.cloudflareaccess.com';
const AUD = 'aud-value';

let originalEnv: Env;

const bot = () => testEnv.TOKEN_STORE.get(testEnv.TOKEN_STORE.idFromName('bot'));

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

describe('/auth/access site_id gate', () => {
  it('rejects a request with no site_id (consistent with /auth)', async () => {
    const token = await signTestAccessJwt(AUD, ISSUER);
    const response = await SELF.fetch('https://worker.example.com/auth/access', {
      headers: { 'Cf-Access-Jwt-Assertion': token },
    });

    expect(response.status).toBe(403);
    const body = await response.text();
    expect(body).toContain('UNSUPPORTED_DOMAIN');
    expect(body).not.toContain('ghu_bot_token'); // no token leaked
  });

  it('still serves the token for an allowed site_id', async () => {
    const token = await signTestAccessJwt(AUD, ISSUER);
    const response = await SELF.fetch(
      'https://worker.example.com/auth/access?site_id=cms.example.com',
      { headers: { 'Cf-Access-Jwt-Assertion': token } },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('ghu_bot_token');
  });
});
