import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../src/types.js';
import { signTestAccessJwt } from '../helpers/access-identity.js';

/**
 * Optionaler Bootstrap-AUD: ist `SETUP_BOOTSTRAP_AUD` gesetzt, erzwingt `/setup`
 * von Anfang an genau dieses AUD (kein TOFU) — ein JWT einer anderen App
 * derselben Team-Domain wird abgewiesen, bevor irgendetwas gespeichert wird.
 * Nicht gesetzt → unverändertes TOFU-Verhalten (kein Zwang).
 */
const testEnv = env as unknown as Env;

const ACCESS_TEAM_DOMAIN = 'team.cloudflareaccess.com';
const ISSUER = `https://${ACCESS_TEAM_DOMAIN}`;
const ADMIN = 'admin@example.com';
const BOOTSTRAP_AUD = 'this-app-aud';
const OTHER_APP_AUD = 'other-app-aud';

let originalEnv: Env;

beforeEach(() => {
  originalEnv = { ...testEnv };
  Object.assign(testEnv, {
    ACCESS_TEAM_DOMAIN,
    SETUP_ADMINS: ADMIN,
    GITHUB_AUTH_URL: '',
  });
});

afterEach(() => {
  Object.keys(testEnv).forEach((key) => delete (testEnv as unknown as Record<string, unknown>)[key]);
  Object.assign(testEnv, originalEnv);
});

const fetchSetup = async (aud: string): Promise<Response> => {
  const token = await signTestAccessJwt(aud, ISSUER, { email: ADMIN });
  return SELF.fetch('https://worker.example.com/setup', {
    headers: { 'Cf-Access-Jwt-Assertion': token },
  });
};

describe('SETUP_BOOTSTRAP_AUD closes the TOFU window', () => {
  it('rejects a JWT from another app of the same team when the bootstrap AUD is set', async () => {
    testEnv.SETUP_BOOTSTRAP_AUD = BOOTSTRAP_AUD;

    const response = await fetchSetup(OTHER_APP_AUD);

    expect(response.status).toBe(401);
  });

  it('accepts a JWT whose aud matches the bootstrap AUD', async () => {
    testEnv.SETUP_BOOTSTRAP_AUD = BOOTSTRAP_AUD;

    const response = await fetchSetup(BOOTSTRAP_AUD);

    expect(response.status).toBe(200);
  });

  it('keeps the TOFU behaviour (accepts any app of the team) when not set', async () => {
    const response = await fetchSetup(OTHER_APP_AUD);

    expect(response.status).toBe(200);
  });
});
