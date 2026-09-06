import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TokenStore } from '../../src/token-store.js';
import type { Env } from '../../src/types.js';
import { signTestAccessJwt } from '../helpers/access-identity.js';

/**
 * Token-Handover-Origin-Check. Der postMessage-Empfaenger darf den Bot-Token nur
 * an die EXAKT konfigurierte HTTPS-Origin erhalten — kein `http`, kein
 * abweichender Port, keine automatischen Subdomains.
 */
const testEnv = env as unknown as Env;

const ISSUER = 'https://team.cloudflareaccess.com';
const AUD = 'aud-value';

let originalEnv: Env;

beforeEach(() => {
  originalEnv = { ...testEnv };
  Object.assign(testEnv, {
    GITHUB_APP_CLIENT_ID: 'Iv1.testclientid',
    ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
    ACCESS_APP_AUD: AUD,
    ALLOWED_DOMAINS: 'cms.example.com',
    GITHUB_AUTH_URL: '',
    SETUP_ADMINS: 'admin@example.com',
  });
});

afterEach(() => {
  Object.keys(testEnv).forEach((key) => delete (testEnv as unknown as Record<string, unknown>)[key]);
  Object.assign(testEnv, originalEnv);
});

async function fetchSuccessPageHtml(): Promise<string> {
  const stub = testEnv.TOKEN_STORE.get(testEnv.TOKEN_STORE.idFromName('bot'));
  await runInDurableObject(stub, (instance: TokenStore) =>
    instance.storeAuthorization({
      accessToken: 'ghu_bot_token',
      expiresAt: Date.now() + 4 * 3600 * 1000,
      refreshToken: 'refresh-ok',
    }),
  );
  const token = await signTestAccessJwt(AUD, ISSUER);
  const response = await SELF.fetch('https://worker.example.com/auth/access?site_id=cms.example.com', {
    headers: { 'Cf-Access-Jwt-Assertion': token },
  });

  return response.text();
}

/** Liest das eingebettete Array erlaubter Handover-Origins aus dem Script. */
function extractAllowedOrigins(html: string): string[] {
  const match = html.match(/allowedOrigins\s*=\s*(\[[^\]]*\])/);

  if (!match || match[1] === undefined) {
    throw new Error('allowedOrigins array not found in callback script');
  }

  return JSON.parse(match[1]) as string[];
}

describe('Callback token-handover origin check', () => {
  it('trusts only the exact configured https origin — no http, port or subdomain', async () => {
    const allowed = extractAllowedOrigins(await fetchSuccessPageHtml());
    const trusts = (origin: string) => allowed.indexOf(origin) !== -1;

    expect(trusts('https://cms.example.com')).toBe(true); // exact https, default port
    expect(trusts('http://cms.example.com')).toBe(false); // http rejected
    expect(trusts('https://cms.example.com:8443')).toBe(false); // non-default port rejected
    expect(trusts('https://abandoned.cms.example.com')).toBe(false); // subdomain rejected
    expect(trusts('https://cms.example.com.attacker.test')).toBe(false);
    expect(trusts('https://attacker.test')).toBe(false);
    expect(trusts('null')).toBe(false);
  });

  it('embeds exact origins and drops the unsafe hostname/subdomain matcher', async () => {
    const html = await fetchSuccessPageHtml();

    expect(html).toContain('"https://cms.example.com"');
    expect(html).not.toContain("endsWith('.'"); // kein Subdomain-Wildcard
    expect(html).not.toContain('.hostname'); // kein Protokoll/Port-ignorierendes Parsing
  });

  it('binds the reply to the opener and handles a missing opener', async () => {
    const html = await fetchSuccessPageHtml();

    expect(html).toContain('event.source'); // event.source === window.opener
    expect(html).toContain('window.opener'); // fehlender Opener wird behandelt
  });
});
