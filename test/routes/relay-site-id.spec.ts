import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../src/types.js';

/**
 * Der GitHub-Relay-Einstieg (ADR 0017) prueft `site_id` gegen `ALLOWED_DOMAINS`
 * (wie `/auth`), bevor irgendetwas nach aussen geht — das Gate selbst ist
 * unveraendert aus dem vormaligen Proxy uebernommen, nur die Erfolgsantwort
 * ist jetzt die eigene Relay-Seite statt eines 302 auf den Upstream.
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

describe('GitHub-relay site_id entry gate', () => {
  it('rejects /auth/github with a site_id that is not in ALLOWED_DOMAINS', async () => {
    const response = await SELF.fetch(
      'https://worker.example.com/auth/github?site_id=attacker.example.net',
      { redirect: 'manual' },
    );

    expect(response.status).toBe(404);
  });

  it('rejects /auth/github with no site_id at all', async () => {
    const response = await SELF.fetch('https://worker.example.com/auth/github', {
      redirect: 'manual',
    });

    expect(response.status).toBe(404);
  });

  it('renders the relay page for an allowed site_id', async () => {
    const response = await SELF.fetch(
      'https://worker.example.com/auth/github?site_id=cms.example.com',
      { redirect: 'manual' },
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('id="start"');
  });
});
