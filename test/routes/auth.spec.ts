import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConfigEnv } from '../../src/config.js';
import type { Env } from '../../src/types.js';

const testEnv = env as unknown as Env;

const validEnv: ConfigEnv = {
  GITHUB_APP_CLIENT_ID: 'Iv1.testclientid',
  ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
  ACCESS_APP_AUD: 'aud-value',
  ALLOWED_DOMAINS: 'cms.example.com',
  GITHUB_AUTH_URL: '',
  SETUP_ADMINS: 'admin@example.com',
};

let originalEnv: Env;

beforeEach(() => {
  originalEnv = { ...testEnv };
  Object.assign(testEnv, validEnv);
});

afterEach(() => {
  Object.keys(testEnv).forEach((key) => {
    delete (testEnv as unknown as Record<string, unknown>)[key];
  });
  Object.assign(testEnv, originalEnv);
});

describe('GET /auth', () => {
  it('redirects directly to /auth/access when GITHUB_AUTH_URL is unset', async () => {
    const response = await SELF.fetch('https://worker.example.com/auth?site_id=cms.example.com', {
      redirect: 'manual',
    });

    expect(response.status).toBe(302);
    const location = response.headers.get('location');
    expect(location).toContain('/auth/access');
    expect(location).toContain('site_id=cms.example.com');
  });

  it('shows a selection page with both actions when GITHUB_AUTH_URL is set', async () => {
    testEnv.GITHUB_AUTH_URL = 'https://sveltia-cms-auth.example.net/auth';

    const response = await SELF.fetch('https://worker.example.com/auth?site_id=cms.example.com');

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('/auth/github?');
    expect(body).toContain('/auth/access');
  });

  it('serves English when the browser locale is not German (Accept-Language)', async () => {
    testEnv.GITHUB_AUTH_URL = 'https://sveltia-cms-auth.example.net/auth';

    const response = await SELF.fetch('https://worker.example.com/auth?site_id=cms.example.com', {
      headers: { 'accept-language': 'en-US,en;q=0.9' },
    });

    const body = await response.text();
    expect(body).toContain('Sign in with email code');
    expect(body).toContain('<html lang="en">');
  });

  it('serves German for German browser locales and when no locale is sent', async () => {
    testEnv.GITHUB_AUTH_URL = 'https://sveltia-cms-auth.example.net/auth';

    const german = await SELF.fetch('https://worker.example.com/auth?site_id=cms.example.com', {
      headers: { 'accept-language': 'de-DE,de;q=0.9,en;q=0.8' },
    });
    expect(await german.text()).toContain('Mit E-Mail-Code anmelden');

    const noHeader = await SELF.fetch('https://worker.example.com/auth?site_id=cms.example.com');
    expect(await noHeader.text()).toContain('Mit E-Mail-Code anmelden');
  });

  it('rejects a site_id that is not in ALLOWED_DOMAINS (UNSUPPORTED_DOMAIN)', async () => {
    const response = await SELF.fetch('https://worker.example.com/auth?site_id=evil.example.com');

    expect(response.status).toBe(403);
    const body = await response.text();
    expect(body).toContain('UNSUPPORTED_DOMAIN');
  });

  it('rejects when ALLOWED_DOMAINS is empty (open-relay protection disables both ways)', async () => {
    testEnv.ALLOWED_DOMAINS = '';

    const response = await SELF.fetch('https://worker.example.com/auth?site_id=cms.example.com');

    expect(response.status).toBe(500);
  });

  it('reports missing required anchors by key name (ADR 0014)', async () => {
    testEnv.ACCESS_TEAM_DOMAIN = '';
    testEnv.SETUP_ADMINS = '';

    const response = await SELF.fetch('https://worker.example.com/auth?site_id=cms.example.com');

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toContain('ACCESS_TEAM_DOMAIN');
    expect(body).toContain('SETUP_ADMINS');
  });

  it('shows a setup-incomplete page (linking to /setup) when AUD/client ID are unknown (ADR 0014)', async () => {
    testEnv.GITHUB_APP_CLIENT_ID = '';
    testEnv.ACCESS_APP_AUD = '';

    const response = await SELF.fetch('https://worker.example.com/auth?site_id=cms.example.com');

    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain('/setup');
  });

  it('returns 405 for unsupported methods', async () => {
    const response = await SELF.fetch('https://worker.example.com/auth?site_id=cms.example.com', {
      method: 'POST',
    });

    expect(response.status).toBe(405);
  });
});

describe('unknown routes', () => {
  it('returns 404', async () => {
    const response = await SELF.fetch('https://worker.example.com/does-not-exist');

    expect(response.status).toBe(404);
  });
});
