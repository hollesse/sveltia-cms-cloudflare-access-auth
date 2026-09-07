import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../src/types.js';
import { signTestAccessJwt } from '../helpers/access-identity.js';

const testEnv = env as unknown as Env;

const ACCESS_TEAM_DOMAIN = 'team.cloudflareaccess.com';
const ACCESS_APP_AUD = 'aud-value';
const ISSUER = `https://${ACCESS_TEAM_DOMAIN}`;
const ORIGIN = 'https://worker.example.com';

let originalEnv: Env;

const authedHeaders = async (email = 'admin@example.com') => ({
  'Cf-Access-Jwt-Assertion': await signTestAccessJwt(ACCESS_APP_AUD, ISSUER, { email }),
});

async function start(headers: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await SELF.fetch(`${ORIGIN}/setup/github/start`, { method: 'POST', headers });
  return (await res.json()) as Record<string, unknown>;
}

async function poll(headers: Record<string, string>, payload: unknown): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/setup/github/poll`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function botAuthorized(): Promise<boolean> {
  const stub = testEnv.TOKEN_STORE.get(testEnv.TOKEN_STORE.idFromName('bot'));
  return stub.status().then((s) => s.authorized);
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

describe('device flow is bound to the authorized setup session', () => {
  it('never exposes the raw device_code to the browser (only an opaque txId + user code)', async () => {
    const started = await start(await authedHeaders());

    expect(started.ok).toBe(true);
    expect(started.userCode).toBe('ABCD-1234');
    expect(started.txId).toBeTypeOf('string');
    expect((started.txId as string).length).toBeGreaterThan(8);
    expect(started).not.toHaveProperty('deviceCode');
  });

  it('rejects a poll for a transaction that was not started by this session', async () => {
    const response = await poll(await authedHeaders(), { txId: 'not-a-real-transaction' });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false });
    expect(await botAuthorized()).toBe(false);
  });

  it('rejects a raw device_code smuggled in the poll body (no txId)', async () => {
    // The old attack surface: polling an attacker-controlled device_code directly.
    await start(await authedHeaders());
    const response = await poll(await authedHeaders(), { deviceCode: 'device-badaccount' });

    expect(response.status).toBe(400);
    expect(await botAuthorized()).toBe(false);
  });

  it('completes a flow started and polled by the same session', async () => {
    const headers = await authedHeaders();
    const started = await start(headers);
    const response = await poll(headers, { txId: started.txId });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(await botAuthorized()).toBe(true);
  });
});
