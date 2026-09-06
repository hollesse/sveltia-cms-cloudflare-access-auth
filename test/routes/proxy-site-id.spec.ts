import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../src/types.js';

/**
 * Der GitHub-Delegations-Proxy soll am Einstieg `/auth/github` den `site_id`
 * gegen `ALLOWED_DOMAINS` prüfen (wie `/auth`), bevor irgendetwas nach außen
 * geht — statt jeden `site_id` durchzureichen. `/callback` traegt keinen
 * vertrauenswuerdigen site_id (GitHub kontrolliert den Redirect) und bleibt
 * daher am Upstream-Origin-Check gebunden.
 */
const testEnv = env as unknown as Env;

let originalEnv: Env;

beforeEach(() => {
  originalEnv = { ...testEnv };
  Object.assign(testEnv, {
    GITHUB_APP_CLIENT_ID: 'Iv1.testclientid',
    ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
    ACCESS_APP_AUD: 'aud-value',
    ALLOWED_DOMAINS: 'cms.example.com',
    GITHUB_AUTH_URL: 'https://sveltia-cms-auth.example.net',
    SETUP_ADMINS: 'admin@example.com',
  });
});

afterEach(() => {
  Object.keys(testEnv).forEach((key) => delete (testEnv as unknown as Record<string, unknown>)[key]);
  Object.assign(testEnv, originalEnv);
});

describe('GitHub-proxy site_id entry gate', () => {
  it('rejects /auth/github with a site_id that is not in ALLOWED_DOMAINS', async () => {
    const response = await SELF.fetch(
      'https://worker.example.com/auth/github?site_id=attacker.example.net',
      { redirect: 'manual' },
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('location')).toBeNull(); // no outbound redirect
  });

  it('rejects /auth/github with no site_id at all', async () => {
    const response = await SELF.fetch('https://worker.example.com/auth/github', {
      redirect: 'manual',
    });

    expect(response.status).toBe(404);
  });

  it('still proxies /auth/github for an allowed site_id', async () => {
    const response = await SELF.fetch(
      'https://worker.example.com/auth/github?site_id=cms.example.com',
      { redirect: 'manual' },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('github.com/login/oauth/authorize');
  });
});
