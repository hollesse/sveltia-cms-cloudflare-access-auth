import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../src/types.js';
import { signTestAccessJwt } from '../helpers/access-identity.js';

/**
 * CSRF-Schutz der /setup/*-POST-Endpunkte. Der Access-JWT wird von Cloudflare aus
 * dem CF_Authorization-Cookie injiziert; je nach SameSite geht dieses bei
 * Cross-Site-POSTs mit. Der Worker bindet zustandsaendernde Requests deshalb
 * zusaetzlich an die eigene Origin: fremder Origin -> 403 ohne Zustandsaenderung,
 * same-origin und fehlender Origin bleiben erlaubt.
 */
const testEnv = env as unknown as Env;

const ISSUER = 'https://team.cloudflareaccess.com';
const AUD = 'aud-value';
const ORIGIN = 'https://worker.example.com';
const HOSTILE = 'https://attacker.example.net';

let originalEnv: Env;

const bot = () => testEnv.TOKEN_STORE.get(testEnv.TOKEN_STORE.idFromName('bot'));
const adminHeaders = async () => ({
  'Cf-Access-Jwt-Assertion': await signTestAccessJwt(AUD, ISSUER, { email: 'admin@example.com' }),
});

beforeEach(async () => {
  originalEnv = { ...testEnv };
  Object.assign(testEnv, {
    GITHUB_APP_CLIENT_ID: 'Iv1.testclientid',
    ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
    ACCESS_APP_AUD: AUD,
    ALLOWED_DOMAINS: 'cms.example.com',
    GITHUB_AUTH_URL: 'https://sveltia-cms-auth.example.net',
    SETUP_ADMINS: 'admin@example.com',
  });
  await runInDurableObject(bot(), async (_instance, state) => state.storage.deleteAll());
});

afterEach(() => {
  Object.keys(testEnv).forEach((key) => delete (testEnv as unknown as Record<string, unknown>)[key]);
  Object.assign(testEnv, originalEnv);
});

describe('CSRF-Schutz der /setup/*-POST-Endpunkte', () => {
  const WRITE_PATHS = [
    '/setup/settings',
    '/setup/github/start',
    '/setup/github/poll',
    '/setup/github/rotate',
    '/setup/github/disconnect',
    '/setup/users/clear',
    '/setup/users/delete',
  ];

  it('rejects every write endpoint when the Origin is cross-site (403)', async () => {
    for (const path of WRITE_PATHS) {
      const response = await SELF.fetch(ORIGIN + path, {
        method: 'POST',
        headers: { ...(await adminHeaders()), origin: HOSTILE, 'content-type': 'application/json' },
        body: '{}',
      });

      expect(response.status, path).toBe(403);
    }
  });

  it('a cross-origin text/plain POST cannot overwrite settings (the original CSRF vector)', async () => {
    const response = await SELF.fetch(ORIGIN + '/setup/settings', {
      method: 'POST',
      headers: { ...(await adminHeaders()), origin: HOSTILE, 'content-type': 'text/plain' },
      body: JSON.stringify({ githubAuthUrl: 'https://attacker.example.net' }),
    });

    expect(response.status).toBe(403);
    expect((await bot().getSettings()).githubAuthUrl).toBeUndefined();
  });

  it('a cross-origin POST cannot disconnect the bot', async () => {
    await bot().storeAuthorization({
      accessToken: 'ghu_x',
      expiresAt: Date.now() + 3600 * 1000,
      refreshToken: 'refresh-ok',
    });

    const response = await SELF.fetch(ORIGIN + '/setup/github/disconnect', {
      method: 'POST',
      headers: { ...(await adminHeaders()), origin: HOSTILE },
    });

    expect(response.status).toBe(403);
    expect((await bot().status()).authorized).toBe(true);
  });

  it('accepts a same-origin settings POST (regression: the real dashboard still works)', async () => {
    const response = await SELF.fetch(ORIGIN + '/setup/settings', {
      method: 'POST',
      headers: { ...(await adminHeaders()), origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ allowedDomains: 'cms.example.com' }),
    });

    expect(response.status).toBe(200);
  });

  it('allows a POST with no Origin header (non-browser client, e.g. existing tests)', async () => {
    const response = await SELF.fetch(ORIGIN + '/setup/users/clear', {
      method: 'POST',
      headers: await adminHeaders(),
    });

    expect(response.status).toBe(200);
  });

  it('rejects a non-JSON content-type on JSON endpoints even when same-origin (415)', async () => {
    const response = await SELF.fetch(ORIGIN + '/setup/settings', {
      method: 'POST',
      headers: { ...(await adminHeaders()), origin: ORIGIN, 'content-type': 'text/plain' },
      body: JSON.stringify({ allowedDomains: 'cms.example.com' }),
    });

    expect(response.status).toBe(415);
  });
});
