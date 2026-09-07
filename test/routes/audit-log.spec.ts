import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TokenStore } from '../../src/token-store.js';
import type { Env } from '../../src/types.js';
import { signTestAccessJwt } from '../helpers/access-identity.js';
import { connectBot } from '../helpers/device-flow.js';

/**
 * Security-Event-Audit-Log: unveränderliche Ereignisse für
 * Settings-Änderungen, Connect/Disconnect und Rotation — mit Akteur + Zeit,
 * ohne Tokenwerte, append-only (Cap 200), nicht per UI löschbar.
 */
const testEnv = env as unknown as Env;

const ISSUER = 'https://team.cloudflareaccess.com';
const AUD = 'aud-value';
const ORIGIN = 'https://worker.example.com';
const ADMIN = 'admin@example.com';

let originalEnv: Env;

const bot = () => testEnv.TOKEN_STORE.get(testEnv.TOKEN_STORE.idFromName('bot'));
const adminHeaders = async () => ({
  'Cf-Access-Jwt-Assertion': await signTestAccessJwt(AUD, ISSUER, { email: ADMIN }),
});
const jsonHeaders = async () => ({ ...(await adminHeaders()), origin: ORIGIN, 'content-type': 'application/json' });
const seedBot = () =>
  bot().storeAuthorization({ accessToken: 'ghu_bot_token', expiresAt: Date.now() + 3_600_000, refreshToken: 'refresh-ok' });

beforeEach(async () => {
  originalEnv = { ...testEnv };
  Object.assign(testEnv, {
    GITHUB_APP_CLIENT_ID: 'Iv1.testclientid',
    ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
    ACCESS_APP_AUD: AUD,
    ALLOWED_DOMAINS: 'cms.example.com',
    GITHUB_AUTH_URL: '',
    SETUP_ADMINS: ADMIN,
  });
  await runInDurableObject(bot(), async (_instance: TokenStore, state) => state.storage.deleteAll());
});

afterEach(() => {
  Object.keys(testEnv).forEach((key) => delete (testEnv as unknown as Record<string, unknown>)[key]);
  Object.assign(testEnv, originalEnv);
});

describe('TokenStore audit event log', () => {
  it('appends events and lists them newest-first', async () => {
    await bot().recordEvent({ type: 'settings_updated', actor: 'x@example.com' }, 1000);
    await bot().recordEvent({ type: 'token_rotated', actor: 'y@example.com' }, 2000);

    const events = await bot().listEvents();
    expect(events.map((e) => e.type)).toEqual(['token_rotated', 'settings_updated']);
    expect(events[0]!).toMatchObject({ type: 'token_rotated', actor: 'y@example.com', at: 2000 });
  });

  it('caps the log at 200 (oldest roll out)', async () => {
    for (let i = 0; i < 205; i += 1) {
      await bot().recordEvent({ type: `t${i}`, actor: 'x@example.com' }, i);
    }
    const events = await bot().listEvents();
    expect(events.length).toBe(200);
    expect(events[0]!.type).toBe('t204'); // newest kept
    expect(events[199]!.type).toBe('t5'); // oldest kept
  });
});

describe('setup handlers record security events', () => {
  const types = async () => (await bot().listEvents()).map((e) => e.type);

  it('records settings_updated with the admin actor and no secrets', async () => {
    await SELF.fetch(`${ORIGIN}/setup/settings`, {
      method: 'POST',
      headers: await jsonHeaders(),
      body: JSON.stringify({ allowedDomains: 'cms.example.com' }),
    });

    const events = await bot().listEvents();
    const event = events.find((e) => e.type === 'settings_updated');
    expect(event?.actor).toBe(ADMIN);
    expect(JSON.stringify(events)).not.toContain('ghu_');
  });

  it('records bot_disconnected', async () => {
    await seedBot();
    await SELF.fetch(`${ORIGIN}/setup/github/disconnect`, {
      method: 'POST',
      headers: { ...(await adminHeaders()), origin: ORIGIN },
    });
    expect(await types()).toContain('bot_disconnected');
  });

  it('records token_rotated', async () => {
    await seedBot();
    await SELF.fetch(`${ORIGIN}/setup/github/rotate`, {
      method: 'POST',
      headers: { ...(await adminHeaders()), origin: ORIGIN },
    });
    expect(await types()).toContain('token_rotated');
  });

  it('records bot_connected after a successful device-flow poll', async () => {
    await connectBot(ORIGIN, await jsonHeaders());
    expect(await types()).toContain('bot_connected');
  });
});

describe('dashboard shows the audit log', () => {
  it('renders an audit section with recorded events', async () => {
    await seedBot();
    await bot().recordEvent({ type: 'token_rotated', actor: ADMIN }, Date.now());

    const response = await SELF.fetch(`${ORIGIN}/setup`, { headers: await adminHeaders() });
    const html = await response.text();

    expect(html).toContain('data-section="audit"');
    expect(html).toContain(ADMIN);
  });
});
