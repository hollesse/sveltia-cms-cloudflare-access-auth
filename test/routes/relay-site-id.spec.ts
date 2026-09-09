import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../src/types.js';

/**
 * Der GitHub-Delegations-Einstieg (ADR 0017-Nachtrag: jetzt Teil der
 * Auswahl-Seite `GET /auth` statt einer eigenen `/auth/github`-Route) prueft
 * `site_id` gegen `ALLOWED_DOMAINS`, bevor irgendetwas gerendert wird — das
 * Gate selbst ist unveraendert aus dem vormaligen Relay-Einstieg
 * uebernommen, es sitzt jetzt in `handleAuth` selbst.
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

describe('GitHub-delegation site_id entry gate (on /auth, ADR 0017-Nachtrag)', () => {
  it('rejects /auth with a site_id that is not in ALLOWED_DOMAINS', async () => {
    const response = await SELF.fetch(
      'https://worker.example.com/auth?site_id=attacker.example.net',
      { redirect: 'manual' },
    );

    expect(response.status).toBe(403);
  });

  it('rejects /auth with no site_id at all', async () => {
    const response = await SELF.fetch('https://worker.example.com/auth', {
      redirect: 'manual',
    });

    expect(response.status).toBe(403);
  });

  it('renders the selection page with the embedded GitHub handshake for an allowed site_id', async () => {
    const response = await SELF.fetch(
      'https://worker.example.com/auth?site_id=cms.example.com',
      { redirect: 'manual' },
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('id="start"');
  });
});
