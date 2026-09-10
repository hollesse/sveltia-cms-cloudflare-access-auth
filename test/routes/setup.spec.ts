import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TokenStore } from '../../src/token-store.js';
import type { Env } from '../../src/types.js';
import { signTestAccessJwt } from '../helpers/access-identity.js';
import { connectBot } from '../helpers/device-flow.js';

const testEnv = env as unknown as Env;

const ACCESS_TEAM_DOMAIN = 'team.cloudflareaccess.com';
const ACCESS_APP_AUD = 'aud-value';
const ISSUER = `https://${ACCESS_TEAM_DOMAIN}`;

let originalEnv: Env;

beforeEach(() => {
  originalEnv = { ...testEnv };
  Object.assign(testEnv, {
    GITHUB_APP_CLIENT_ID: 'Iv1.testclientid',
    ACCESS_TEAM_DOMAIN,
    ACCESS_APP_AUD,
    ALLOWED_DOMAINS: 'cms.example.com',
    GITHUB_AUTH_URL: '',
    SETUP_ADMINS: 'Admin@Example.com',
  });
});

afterEach(() => {
  Object.keys(testEnv).forEach((key) => {
    delete (testEnv as unknown as Record<string, unknown>)[key];
  });
  Object.assign(testEnv, originalEnv);
});

const authedHeaders = async (email = 'admin@example.com') => ({
  'Cf-Access-Jwt-Assertion': await signTestAccessJwt(ACCESS_APP_AUD, ISSUER, { email }),
});

describe('/setup/github', () => {
  it('hard-rejects setup routes without a valid Access-JWT', async () => {
    expect((await SELF.fetch('https://worker.example.com/setup/github')).status).toBe(401);
    expect(
      (await SELF.fetch('https://worker.example.com/setup/github/start', { method: 'POST' }))
        .status,
    ).toBe(401);
  });

  it('rejects an authenticated user who is not a setup admin (role gate, ADR 0012)', async () => {
    const response = await SELF.fetch('https://worker.example.com/setup/github', {
      headers: await authedHeaders('nutzerin@example.com'),
    });

    expect(response.status).toBe(403);
    expect(await response.text()).toContain('Administratoren vorbehalten');
  });

  it('reports missing_required when SETUP_ADMINS (a mandatory anchor, ADR 0014) is empty', async () => {
    testEnv.SETUP_ADMINS = '';

    const response = await SELF.fetch('https://worker.example.com/setup/github', {
      headers: await authedHeaders(),
    });

    expect(response.status).toBe(500);
    expect(await response.text()).toContain('SETUP_ADMINS');
  });

  it('locks setup when SETUP_ADMINS parses to an empty list (fail-closed edge case)', async () => {
    testEnv.SETUP_ADMINS = ' , , ';

    const response = await SELF.fetch('https://worker.example.com/setup/github', {
      headers: await authedHeaders(),
    });

    expect(response.status).toBe(403);
    expect(await response.text()).toContain('SETUP_ADMINS');
  });

  it('renders the setup page for an authenticated operator', async () => {
    const response = await SELF.fetch('https://worker.example.com/setup/github', {
      headers: await authedHeaders(),
    });

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('Mit GitHub verbinden');
    expect(body).toContain('MANAGE_USERS_URL');
  });

  it('links directly to the users policy when MANAGE_USERS_URL is set', async () => {
    testEnv.MANAGE_USERS_URL =
      'https://dash.cloudflare.com/acc/one/access-controls/policies/pol/edit';

    const response = await SELF.fetch('https://worker.example.com/setup/github', {
      headers: await authedHeaders(),
    });

    const body = await response.text();
    expect(body).toContain('https://dash.cloudflare.com/acc/one/access-controls/policies/pol/edit');
    expect(body).toContain('Policy im Cloudflare-Dashboard oeffnen');
  });

  it('starts the device flow and returns the user code', async () => {
    const response = await SELF.fetch('https://worker.example.com/setup/github/start', {
      method: 'POST',
      headers: await authedHeaders(),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, userCode: 'ABCD-1234' });
  });

  it('stores the token pair once polling succeeds', async () => {
    const response = await connectBot('https://worker.example.com', await authedHeaders());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const stub = testEnv.TOKEN_STORE.get(testEnv.TOKEN_STORE.idFromName('bot'));
    const status = await stub.status();

    expect(status.authorized).toBe(true);
  });

  it('relays pending polls without storing anything', async () => {
    testEnv.GITHUB_APP_CLIENT_ID = 'client-pending';

    const response = await connectBot('https://worker.example.com', await authedHeaders());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: false, reason: 'pending' });
  });

  it('rotates the token pair on demand (invalidates the outstanding token)', async () => {
    const stub = testEnv.TOKEN_STORE.get(testEnv.TOKEN_STORE.idFromName('bot'));

    await runInDurableObject(stub, (instance: TokenStore) =>
      instance.storeAuthorization({
        accessToken: 'ghu_old',
        expiresAt: Date.now() + 7 * 3600 * 1000,
        refreshToken: 'refresh-ok',
      }),
    );

    const response = await SELF.fetch('https://worker.example.com/setup/github/rotate', {
      method: 'POST',
      headers: await authedHeaders(),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, token: 'ghu_fresh_token' });
  });

  it('disconnects the bot: clears the stored token pair (admin-gated)', async () => {
    const stub = testEnv.TOKEN_STORE.get(testEnv.TOKEN_STORE.idFromName('bot'));
    await runInDurableObject(stub, (instance: TokenStore) =>
      instance.storeAuthorization({
        accessToken: 'ghu_old',
        expiresAt: Date.now() + 3600 * 1000,
        refreshToken: 'refresh-ok',
      }),
    );

    const response = await SELF.fetch('https://worker.example.com/setup/github/disconnect', {
      method: 'POST',
      headers: await authedHeaders(),
    });

    expect(response.status).toBe(200);
    expect((await stub.status()).authorized).toBe(false);
  });
});
