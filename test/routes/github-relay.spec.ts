import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../src/types.js';

/**
 * ADR 0017-Nachtrag (infrastructure-m4v9k): der Ein-Klick-GitHub-Login laeuft
 * jetzt vollstaendig auf der Auswahl-Seite (`GET /auth`) — die separate
 * `/auth/github`-Zwischenseite (`handleGithubRelay`, `renderGithubRelayPage`)
 * ist entfernt. `/auth/github` ist daher unabhaengig von der Konfiguration
 * 404. Der eigentliche Doppel-Handshake wird jetzt ab dem Auswahl-Screen in
 * `test/e2e/github-relay.spec.ts` mit echtem Chromium geprueft; das
 * `site_id`-Gate an der Auswahl-Route in `test/routes/relay-site-id.spec.ts`.
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

describe('GET /auth/github (removed, ADR 0017-Nachtrag: Ein-Klick-Login auf der Auswahl-Seite)', () => {
  it('is 404 even though GitHub delegation is fully configured', async () => {
    const response = await SELF.fetch(
      'https://worker.example.com/auth/github?site_id=cms.example.com',
      { redirect: 'manual' },
    );

    expect(response.status).toBe(404);
  });

  it('is 404 with no site_id at all', async () => {
    const response = await SELF.fetch('https://worker.example.com/auth/github', {
      redirect: 'manual',
    });

    expect(response.status).toBe(404);
  });
});

describe('GET /callback (removed, ADR 0017)', () => {
  it('no longer exists', async () => {
    const response = await SELF.fetch('https://worker.example.com/callback?code=abc&state=x');

    expect(response.status).toBe(404);
  });
});
