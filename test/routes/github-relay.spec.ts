import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../src/types.js';

/**
 * ADR 0017: `/auth/github` liefert eine EIGENE Relay-Seite statt fremdes
 * Upstream-HTML durchzureichen; `/callback` existiert nicht mehr. Der
 * eigentliche Doppel-Handshake (Popup-aus-Popup) wird in
 * `test/e2e/github-relay.spec.ts` mit echtem Chromium geprueft — hier nur
 * Routen-Ebene: richtige Seite, richtige Header, kein Upstream-Kontakt.
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

describe('GET /auth/github (postMessage relay, ADR 0017)', () => {
  it('renders our own relay page for an allowed site_id — no upstream redirect, no upstream contact', async () => {
    const response = await SELF.fetch(
      'https://worker.example.com/auth/github?site_id=cms.example.com',
      { redirect: 'manual' },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');

    const body = await response.text();

    // Eigenes Markup, kein durchgereichtes Upstream-HTML.
    expect(body).toContain('id="start"');
    expect(body).not.toContain('unhandled mock request');
  });

  it('carries the full security headers including CSP (own page, unlike the former pass-through)', async () => {
    const response = await SELF.fetch(
      'https://worker.example.com/auth/github?site_id=cms.example.com',
    );

    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('embeds the upstream origin and the upstream /auth URL with provider=github and site_id preserved', async () => {
    const response = await SELF.fetch(
      'https://worker.example.com/auth/github?site_id=cms.example.com',
    );
    const body = await response.text();

    expect(body).toContain('"https://sveltia-cms-auth.example.net"');
    expect(body).toContain('sveltia-cms-auth.example.net/auth?site_id=cms.example.com&provider=github');
  });

  it('embeds the exact configured handover origin for the final CMS handover, like the callback pages', async () => {
    const response = await SELF.fetch(
      'https://worker.example.com/auth/github?site_id=cms.example.com',
    );
    const body = await response.text();

    expect(body).toContain('"https://cms.example.com"');
  });

  it('returns 404 when GITHUB_AUTH_URL is unset (delegation not configured)', async () => {
    testEnv.GITHUB_AUTH_URL = '';

    const response = await SELF.fetch(
      'https://worker.example.com/auth/github?site_id=cms.example.com',
    );

    expect(response.status).toBe(404);
  });
});

describe('GET /callback (removed, ADR 0017)', () => {
  it('no longer exists', async () => {
    const response = await SELF.fetch('https://worker.example.com/callback?code=abc&state=x');

    expect(response.status).toBe(404);
  });
});
