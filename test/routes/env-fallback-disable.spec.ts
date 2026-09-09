import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildLoadedConfig } from '../../src/config.js';
import type { TokenStore } from '../../src/token-store.js';
import type { Env } from '../../src/types.js';
import { signTestAccessJwt } from '../helpers/access-identity.js';

/**
 * "Nicht gesetzt -> Env-Fallback" vs. "explizit deaktiviert" muessen
 * unterscheidbar sein: wer im Dashboard eine Proxy-URL leert, bei der ein
 * Env-Fallback existiert (migriertes Deployment), soll den Proxy wirklich
 * abschalten koennen — der Env-Wert darf nicht wieder aufleben.
 */
const testEnv = env as unknown as Env;

const ISSUER = 'https://team.cloudflareaccess.com';
const AUD = 'aud-value';
const ORIGIN = 'https://worker.example.com';
const ANCHORS = { accessTeamDomain: 'team.cloudflareaccess.com', setupAdmins: ['admin@example.com'] };

let originalEnv: Env;

const bot = () => testEnv.TOKEN_STORE.get(testEnv.TOKEN_STORE.idFromName('bot'));
const admin = async () => ({
  'Cf-Access-Jwt-Assertion': await signTestAccessJwt(AUD, ISSUER, { email: 'admin@example.com' }),
});
const settingsHeaders = async () => ({
  ...(await admin()),
  origin: ORIGIN,
  'content-type': 'application/json',
});

beforeEach(async () => {
  originalEnv = { ...testEnv };
  Object.assign(testEnv, {
    GITHUB_APP_CLIENT_ID: 'Iv1.testclientid',
    ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
    ACCESS_APP_AUD: AUD,
    ALLOWED_DOMAINS: 'cms.example.com',
    GITHUB_AUTH_URL: 'https://sveltia-cms-auth.example.net', // Env-Fallback vorhanden
    SETUP_ADMINS: 'admin@example.com',
  });
  await runInDurableObject(bot(), async (_instance: TokenStore, state) => state.storage.deleteAll());
});

afterEach(() => {
  Object.keys(testEnv).forEach((key) => delete (testEnv as unknown as Record<string, unknown>)[key]);
  Object.assign(testEnv, originalEnv);
});

describe('Env-Fallback vs. explicit disable', () => {
  it('keeps the env fallback when the setting was never touched (migration path)', async () => {
    const effective = buildLoadedConfig(ANCHORS, await bot().getSettings(), testEnv);

    expect(effective.githubAuthUrl).toBe('https://sveltia-cms-auth.example.net');
  });

  it('stays disabled after clearing the URL, even though an env fallback exists', async () => {
    const response = await SELF.fetch(`${ORIGIN}/setup/settings`, {
      method: 'POST',
      headers: await settingsHeaders(),
      body: JSON.stringify({ githubAuthUrl: '' }),
    });
    expect(response.status).toBe(200);

    const effective = buildLoadedConfig(ANCHORS, await bot().getSettings(), testEnv);
    expect(effective.githubAuthUrl).toBeUndefined();

    // Der GitHub-Weg ist damit wirklich aus: `/auth` zeigt keine Auswahl mehr
    // an, sondern geht direkt zum E-Mail-Weg durch (ADR 0017-Nachtrag: der
    // Handshake ist jetzt in der Auswahl-Seite eingebettet, es gibt keine
    // separate `/auth/github`-Route mehr, die man einzeln abfragen koennte).
    const auth = await SELF.fetch(`${ORIGIN}/auth?site_id=cms.example.com`, {
      redirect: 'manual',
    });
    expect(auth.status).toBe(302);
    expect(auth.headers.get('location')).toContain('/auth/access');
  });

  it('re-enables the proxy when a valid URL is set again', async () => {
    await SELF.fetch(`${ORIGIN}/setup/settings`, {
      method: 'POST',
      headers: await settingsHeaders(),
      body: JSON.stringify({ githubAuthUrl: '' }),
    });
    await SELF.fetch(`${ORIGIN}/setup/settings`, {
      method: 'POST',
      headers: await settingsHeaders(),
      body: JSON.stringify({ githubAuthUrl: 'https://other-auth.example.net' }),
    });

    const effective = buildLoadedConfig(ANCHORS, await bot().getSettings(), testEnv);
    expect(effective.githubAuthUrl).toBe('https://other-auth.example.net');

    const auth = await SELF.fetch(`${ORIGIN}/auth?site_id=cms.example.com`);
    expect(auth.status).toBe(200);
    const body = await auth.text();
    expect(body).toContain('other-auth.example.net/auth?site_id=cms.example.com&provider=github');
  });
});
