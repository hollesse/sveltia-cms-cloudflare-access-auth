import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TokenStore } from '../../src/token-store.js';
import type { Env } from '../../src/types.js';
import { signTestAccessJwt } from '../helpers/access-identity.js';

const testEnv = env as unknown as Env;

const ACCESS_TEAM_DOMAIN = 'team.cloudflareaccess.com';
const ACCESS_APP_AUD = 'aud-value';
const ISSUER = `https://${ACCESS_TEAM_DOMAIN}`;
const ORIGIN = 'https://worker.example.com';

let originalEnv: Env;

function botStub(): ReturnType<Env['TOKEN_STORE']['get']> {
  return testEnv.TOKEN_STORE.get(testEnv.TOKEN_STORE.idFromName('bot'));
}

async function seedBotToken(): Promise<void> {
  await runInDurableObject(botStub(), (instance: TokenStore) =>
    instance.storeAuthorization({
      accessToken: 'ghu_bot_token',
      expiresAt: Date.now() + 4 * 3600 * 1000,
      refreshToken: 'refresh-ok',
    }),
  );
}

async function setLoginDisabled(disabled: boolean): Promise<void> {
  await runInDurableObject(botStub(), (instance: TokenStore) =>
    instance.updateSettings({ loginDisabled: disabled }),
  );
}

async function requestToken(): Promise<Response> {
  const token = await signTestAccessJwt(ACCESS_APP_AUD, ISSUER);

  return SELF.fetch(`${ORIGIN}/auth/access?site_id=cms.example.com`, {
    headers: { 'Cf-Access-Jwt-Assertion': token },
  });
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

describe('editor login toggle', () => {
  it('withholds the token when login is disabled, even with a valid Access-JWT', async () => {
    await seedBotToken();
    await setLoginDisabled(true);

    const response = await requestToken();

    expect(response.status).toBe(503);
    const body = await response.text();
    // Popup-safe error page — never the token value in the body.
    expect(body).not.toContain('ghu_bot_token');
    expect(body).not.toContain("':success:'");
  });

  it('resumes normal sign-in once login is re-enabled', async () => {
    await seedBotToken();
    await setLoginDisabled(true);
    await setLoginDisabled(false);

    const response = await requestToken();

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('ghu_bot_token');
    expect(body).toContain("':success:'");
  });

  it('is off by default: a fresh install issues tokens normally', async () => {
    await seedBotToken();

    const response = await requestToken();

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('ghu_bot_token');
  });
});
