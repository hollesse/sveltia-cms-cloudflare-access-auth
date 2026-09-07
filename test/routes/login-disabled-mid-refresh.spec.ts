import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TokenStore } from '../../src/token-store.js';
import type { Env } from '../../src/types.js';
import { signTestAccessJwt } from '../helpers/access-identity.js';

/**
 * Reaudit R2 (auth-f2t6w), Route-Ebene: ein Login, dessen Notfall-Refresh
 * erst NACH einer bestaetigten Sperrung antwortet, muss trotzdem mit der
 * 503-"Login deaktiviert"-Seite enden — ohne Tokenwert im Body. Die Sperre
 * kommt hier ueber den ECHTEN `POST /setup/login`-Handler, ausgeloest
 * waehrend das DO-Input-Gate durch den ausstehenden GitHub-Fetch offen ist
 * (`doRefresh`, `src/token-store.ts`).
 *
 * Interleaving-Technik: `globalThis.fetch` wird gepatcht, ABER die Sperr-
 * Anfrage laeuft NICHT ueber ein von aussen aufgeloestes Gate (zerstoert den
 * IoContext, siehe `test/routes/device-flow-binding.spec.ts`), sondern ALS
 * TEIL der eigenen Continuation des gemockten Fetch-Aufrufs: der Mock ruft
 * den echten `/setup/login`-Request selbst — ein ganz normaler
 * verschachtelter Subrequest, wie der echte GitHub-Call, den er nur
 * beobachtet — und reicht danach an den echten Fetch (Miniflare-
 * `outboundService`-Mock) durch. Kein extern aufgeloestes Promise, also kein
 * IoContext-Verlust.
 */
const testEnv = env as unknown as Env;

const ACCESS_TEAM_DOMAIN = 'team.cloudflareaccess.com';
const ACCESS_APP_AUD = 'aud-value';
const ISSUER = `https://${ACCESS_TEAM_DOMAIN}`;
const ORIGIN = 'https://worker.example.com';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';

let originalEnv: Env;

function botStub(): ReturnType<Env['TOKEN_STORE']['get']> {
  return testEnv.TOKEN_STORE.get(testEnv.TOKEN_STORE.idFromName('bot'));
}

/** Restlaufzeit knapp unter MIN_REMAINING_MS (15 Min) — loest im Login-Pfad einen Notfall-Refresh aus. */
async function seedAlmostExpiredBotToken(): Promise<void> {
  await runInDurableObject(botStub(), (instance: TokenStore) =>
    instance.storeAuthorization({
      accessToken: 'ghu_old',
      expiresAt: Date.now() + 5 * 60 * 1000,
      refreshToken: 'refresh-ok',
    }),
  );
}

async function requestToken(): Promise<Response> {
  const token = await signTestAccessJwt(ACCESS_APP_AUD, ISSUER);

  return SELF.fetch(`${ORIGIN}/auth/access?site_id=cms.example.com`, {
    headers: { 'Cf-Access-Jwt-Assertion': token },
  });
}

async function lockLogin(): Promise<Response> {
  const adminToken = await signTestAccessJwt(ACCESS_APP_AUD, ISSUER, { email: 'admin@example.com' });

  return SELF.fetch(`${ORIGIN}/setup/login`, {
    method: 'POST',
    headers: { 'Cf-Access-Jwt-Assertion': adminToken, 'content-type': 'application/json' },
    body: JSON.stringify({ disabled: true }),
  });
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') { return input; }
  if (input instanceof URL) { return input.toString(); }
  return input.url;
}

beforeEach(() => {
  originalEnv = { ...testEnv };
  Object.assign(testEnv, {
    GITHUB_APP_CLIENT_ID: 'Iv1.testclientid',
    ACCESS_TEAM_DOMAIN,
    ACCESS_APP_AUD,
    ALLOWED_DOMAINS: 'cms.example.com',
    GITHUB_AUTH_URL: '',
    SETUP_ADMINS: 'admin@example.com',
  });
});

afterEach(() => {
  Object.keys(testEnv).forEach((key) => {
    delete (testEnv as unknown as Record<string, unknown>)[key];
  });
  Object.assign(testEnv, originalEnv);
});

describe('login lock lands while a token refresh is already in flight (Reaudit R2, auth-f2t6w)', () => {
  it('withholds the token that would otherwise be issued right after the lock', async () => {
    await seedAlmostExpiredBotToken();

    const realFetch = globalThis.fetch;
    let lockResponse: Response | undefined;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (urlOf(input) === GITHUB_TOKEN_URL) {
        // Waehrend GitHubs Antwort noch aussteht (DO-Input-Gate offen):
        // echter Sperr-Request, als verschachtelter Subrequest derselben
        // Continuation — kein extern aufgeloestes Gate, kein IoContext-Verlust.
        lockResponse = await lockLogin();
      }

      return realFetch(input, init);
    }) as typeof fetch;

    let response: Response;
    try {
      response = await requestToken();
    } finally {
      globalThis.fetch = realFetch;
    }

    expect(lockResponse?.status).toBe(200);
    expect(response.status).toBe(503);
    const body = await response.text();
    // Popup-safe error page — kein Tokenwert im Body, weder das alte noch das
    // waehrend der Sperre frisch geholte.
    expect(body).not.toContain('ghu_old');
    expect(body).not.toContain('ghu_fresh_token');
    expect(body).not.toContain("':success:'");
  });
});
