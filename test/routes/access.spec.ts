import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TokenStore } from '../../src/token-store.js';
import type { Env } from '../../src/types.js';
import { signTestAccessJwt } from '../helpers/access-identity.js';

const testEnv = env as unknown as Env;

const ACCESS_TEAM_DOMAIN = 'team.cloudflareaccess.com';
const ACCESS_APP_AUD = 'aud-value';
const ISSUER = `https://${ACCESS_TEAM_DOMAIN}`;

let originalEnv: Env;

/** Befuellt den TokenStore (idFromName('bot'), wie die Route ihn adressiert). */
async function seedBotToken(pair: {
  accessToken: string;
  expiresAt: number;
  refreshToken: string;
}): Promise<void> {
  const stub = testEnv.TOKEN_STORE.get(testEnv.TOKEN_STORE.idFromName('bot'));

  await runInDurableObject(stub, (instance: TokenStore) => instance.storeAuthorization(pair));
}

beforeEach(() => {
  originalEnv = { ...testEnv };
  Object.assign(testEnv, {
    GITHUB_APP_CLIENT_ID: 'Iv1.testclientid',
    ACCESS_TEAM_DOMAIN,
    ACCESS_APP_AUD,
    ALLOWED_DOMAINS: 'cms.example.com',
    GITHUB_AUTH_URL: '',
    SETUP_ADMINS: 'admin@example.com',
  });
});

afterEach(() => {
  Object.keys(testEnv).forEach((key) => {
    delete (testEnv as unknown as Record<string, unknown>)[key];
  });
  Object.assign(testEnv, originalEnv);
});

describe('GET /auth/access', () => {
  it('completes the full email flow and returns the postMessage page without a refreshToken field', async () => {
    await seedBotToken({
      accessToken: 'ghu_bot_token',
      expiresAt: Date.now() + 4 * 3600 * 1000,
      refreshToken: 'refresh-ok',
    });
    const token = await signTestAccessJwt(ACCESS_APP_AUD, ISSUER);

    const response = await SELF.fetch('https://worker.example.com/auth/access?site_id=cms.example.com', {
      headers: { 'Cf-Access-Jwt-Assertion': token },
    });

    expect(response.status).toBe(200);
    const body = await response.text();

    expect(body).toContain("':success:'");
    expect(body).toContain('ghu_bot_token');
    expect(body).not.toContain('refreshToken');
    expect(body).not.toContain('refresh-ok');
  });

  it('embeds the configured ALLOWED_DOMAINS for the client-side postMessage origin check', async () => {
    await seedBotToken({
      accessToken: 'ghu_bot_token',
      expiresAt: Date.now() + 4 * 3600 * 1000,
      refreshToken: 'refresh-ok',
    });
    const token = await signTestAccessJwt(ACCESS_APP_AUD, ISSUER);

    const response = await SELF.fetch('https://worker.example.com/auth/access?site_id=cms.example.com', {
      headers: { 'Cf-Access-Jwt-Assertion': token },
    });

    const body = await response.text();
    expect(body).toContain('cms.example.com');
  });

  it('hard-rejects a request with a missing Access-JWT', async () => {
    const response = await SELF.fetch('https://worker.example.com/auth/access?site_id=cms.example.com');

    expect(response.status).toBe(401);
  });

  it('hard-rejects a forged Access-JWT (wrong audience)', async () => {
    const token = await signTestAccessJwt('wrong-audience', ISSUER);

    const response = await SELF.fetch('https://worker.example.com/auth/access?site_id=cms.example.com', {
      headers: { 'Cf-Access-Jwt-Assertion': token },
    });

    expect(response.status).toBe(401);
  });

  it('hard-rejects an expired Access-JWT', async () => {
    const token = await signTestAccessJwt(ACCESS_APP_AUD, ISSUER, { expiresInSeconds: -60 });

    const response = await SELF.fetch('https://worker.example.com/auth/access?site_id=cms.example.com', {
      headers: { 'Cf-Access-Jwt-Assertion': token },
    });

    expect(response.status).toBe(401);
  });

  it('rejects a site_id that is not in ALLOWED_DOMAINS at the handover gate', async () => {
    const token = await signTestAccessJwt(ACCESS_APP_AUD, ISSUER);

    const response = await SELF.fetch('https://worker.example.com/auth/access?site_id=evil.example.com', {
      headers: { 'Cf-Access-Jwt-Assertion': token },
    });

    expect(response.status).toBe(403);
    expect(await response.text()).toContain('UNSUPPORTED_DOMAIN');
  });

  it('returns a non-hanging postMessage error page when the bot is not yet authorized', async () => {
    const stub = testEnv.TOKEN_STORE.get(testEnv.TOKEN_STORE.idFromName('bot'));
    await runInDurableObject(stub, async (_instance: TokenStore, state) => {
      await state.storage.deleteAll();
    });
    const token = await signTestAccessJwt(ACCESS_APP_AUD, ISSUER);

    const response = await SELF.fetch('https://worker.example.com/auth/access?site_id=cms.example.com', {
      headers: { 'Cf-Access-Jwt-Assertion': token },
    });

    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).toContain("':error:'");
    expect(body).toContain('nicht mit GitHub verbunden');
  });

  it('self-heals via emergency refresh when the cached bot token is stale', async () => {
    await seedBotToken({
      accessToken: 'ghu_stale',
      expiresAt: Date.now() + 60 * 1000,
      refreshToken: 'refresh-ok',
    });
    const token = await signTestAccessJwt(ACCESS_APP_AUD, ISSUER);

    const response = await SELF.fetch('https://worker.example.com/auth/access?site_id=cms.example.com', {
      headers: { 'Cf-Access-Jwt-Assertion': token },
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('ghu_fresh_token');
  });
});
