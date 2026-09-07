import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../src/types.js';

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
  Object.keys(testEnv).forEach((key) => {
    delete (testEnv as unknown as Record<string, unknown>)[key];
  });
  Object.assign(testEnv, originalEnv);
});

describe('GitHub-Delegations-Proxy (Option C, §7.6)', () => {
  it('proxies /auth/github to the external /auth: passes query, relays redirect and csrf cookie', async () => {
    const response = await SELF.fetch(
      'https://worker.example.com/auth/github?site_id=cms.example.com',
      { redirect: 'manual' },
    );

    expect(response.status).toBe(302);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('github.com/login/oauth/authorize');
    expect(location).toContain('site=cms.example.com');
    expect(response.headers.get('set-cookie')).toContain('csrf-token=github_');
  });

  it('proxies /callback to the external /callback: forwards the csrf cookie and relays the postMessage page', async () => {
    const response = await SELF.fetch(
      'https://worker.example.com/callback?code=abc&state=teststate',
      {
        headers: { cookie: 'csrf-token=github_00000000000000000000000000000000' },
        redirect: 'manual',
      },
    );

    expect(response.status).toBe(200);
    const body = await response.text();

    expect(body).toContain('authorization:github:success');
    expect(body).toContain('cookie:csrf-token=github_00000000000000000000000000000000');
    expect(body).toContain('code:abc');
    expect(response.headers.get('set-cookie')).toContain('csrf-token=deleted');
  });

  it('tolerates a GITHUB_AUTH_URL that already ends in /auth', async () => {
    testEnv.GITHUB_AUTH_URL = 'https://sveltia-cms-auth.example.net/auth';

    const response = await SELF.fetch(
      'https://worker.example.com/auth/github?site_id=cms.example.com',
      { redirect: 'manual' },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('github.com/login/oauth/authorize');
  });

  it('returns 404 on the proxy routes when GITHUB_AUTH_URL is unset', async () => {
    testEnv.GITHUB_AUTH_URL = '';

    expect(
      (await SELF.fetch('https://worker.example.com/auth/github', { redirect: 'manual' })).status,
    ).toBe(404);
    expect(
      (await SELF.fetch('https://worker.example.com/callback', { redirect: 'manual' })).status,
    ).toBe(404);
  });

  it('returns 404 on the proxy routes when ALLOWED_DOMAINS is empty (open-relay gate, ADR 0014)', async () => {
    testEnv.ALLOWED_DOMAINS = '';

    expect(
      (
        await SELF.fetch('https://worker.example.com/auth/github?site_id=cms.example.com', {
          redirect: 'manual',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await SELF.fetch('https://worker.example.com/callback?code=abc&state=teststate', {
          redirect: 'manual',
        })
      ).status,
    ).toBe(404);
  });

  // Der Proxy teilt sich den Origin mit /setup. Nur der sveltia-cms-auth-CSRF-
  // Cookie (`csrf-token`) darf den Proxy in beide Richtungen passieren; die
  // Access-Identitaet (`CF_Authorization`) und fremde Cookies duerfen weder zum
  // Upstream gelangen noch aus ihm zum Browser.
  it('does not forward CF_Authorization or other non-CSRF cookies to the upstream', async () => {
    const response = await SELF.fetch(
      'https://worker.example.com/callback?code=abc&state=teststate',
      {
        headers: {
          cookie:
            'csrf-token=github_00000000000000000000000000000000; CF_Authorization=SECRET_ACCESS_JWT; other=x',
        },
        redirect: 'manual',
      },
    );

    expect(response.status).toBe(200);
    const body = await response.text();

    // Der OAuth-CSRF-Cookie muss den Upstream erreichen (Flow-Voraussetzung).
    expect(body).toContain('cookie:csrf-token=github_00000000000000000000000000000000');
    // Access-Identitaet und fremde Cookies duerfen den Upstream NICHT erreichen.
    expect(body).not.toContain('CF_Authorization');
    expect(body).not.toContain('SECRET_ACCESS_JWT');
    expect(body).not.toContain('other=x');
  });

  it('does not relay an upstream-set CF_Authorization cookie back to the browser', async () => {
    const response = await SELF.fetch(
      'https://worker.example.com/callback?code=abc&state=teststate&inject=cf',
      {
        headers: { cookie: 'csrf-token=github_00000000000000000000000000000000' },
        redirect: 'manual',
      },
    );

    expect(response.status).toBe(200);
    const setCookies = response.headers.getSetCookie();
    const joined = setCookies.join('\n');

    // Der legitime CSRF-Cookie wird weiterhin durchgereicht.
    expect(joined).toContain('csrf-token=deleted');
    // Ein vom Upstream gesetztes Access-Cookie wird herausgefiltert.
    expect(joined).not.toContain('CF_Authorization');
  });
});

// R4 (Security-Reaudit gegen e36538c): der Proxy reichte `cache-control` nur
// durch, WENN der Upstream es lieferte — lieferte er nichts, ging `/callback`
// (traegt persoenliche GitHub-Tokens!) ohne no-store/Sicherheitsheader raus;
// einen oeffentlichen Upstream-Wert haette der Worker sogar unveraendert
// weitergegeben. Bewusst KEINE CSP auf Proxy-Antworten: die
// Upstream-Callback-Seite nutzt Inline-Script fuer den postMessage-Handover
// (`authorization:github:success`) — eine CSP bräuchte `unsafe-inline` und
// waere wertlos.
describe('Proxy-Antworten erzwingen no-store und Sicherheitsheader (R4)', () => {
  const expectForcedHeaders = (response: Response): void => {
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  };

  it('erzwingt die Sicherheitsheader auf /callback, wenn der Upstream keinen cache-control liefert', async () => {
    const response = await SELF.fetch(
      'https://worker.example.com/callback?code=abc&state=teststate',
      {
        headers: { cookie: 'csrf-token=github_00000000000000000000000000000000' },
        redirect: 'manual',
      },
    );

    expect(response.status).toBe(200);
    expectForcedHeaders(response);
  });

  it('ueberschreibt einen oeffentlichen Upstream-cache-control auf /callback mit no-store', async () => {
    const response = await SELF.fetch(
      'https://worker.example.com/callback?code=abc&state=teststate&simulate_cache=public',
      {
        headers: { cookie: 'csrf-token=github_00000000000000000000000000000000' },
        redirect: 'manual',
      },
    );

    expect(response.status).toBe(200);
    expectForcedHeaders(response);
  });

  it('erzwingt die Sicherheitsheader auch auf dem 302-Redirect von /auth/github', async () => {
    const response = await SELF.fetch(
      'https://worker.example.com/auth/github?site_id=cms.example.com',
      { redirect: 'manual' },
    );

    expect(response.status).toBe(302);
    expectForcedHeaders(response);
  });

  it('ueberschreibt einen oeffentlichen Upstream-cache-control auch auf dem 302-Redirect', async () => {
    const response = await SELF.fetch(
      'https://worker.example.com/auth/github?site_id=cms.example.com&simulate_cache=public',
      { redirect: 'manual' },
    );

    expect(response.status).toBe(302);
    expectForcedHeaders(response);
  });

  it('erzwingt die Sicherheitsheader auch auf dem 502-Fehlerpfad (Upstream nicht erreichbar)', async () => {
    const response = await SELF.fetch(
      'https://worker.example.com/callback?code=abc&state=teststate&simulate_upstream_down=1',
      {
        headers: { cookie: 'csrf-token=github_00000000000000000000000000000000' },
        redirect: 'manual',
      },
    );

    expect(response.status).toBe(502);
    expectForcedHeaders(response);
  });
});
