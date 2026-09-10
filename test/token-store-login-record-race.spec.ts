import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TokenStore } from '../src/token-store.js';
import type { Env } from '../src/types.js';

/**
 * infrastructure-k2f7w: `access.ts` rief frueher `getAccessToken` und
 * `recordLogin` als ZWEI GETRENNTE DO-Roundtrips auf. Eine Sperre, die exakt
 * zwischen diesen beiden Aufrufen griff, holte die bereits getroffene
 * Ausgabeentscheidung nicht mehr ein. `getAccessTokenForLogin` fasst beides
 * in EINEM DO-Aufruf zusammen — hier reproduziert per Gate-Idiom (analog zu
 * `test/token-store-login-disabled-race.spec.ts`, Reaudit R2 auth-f2t6w):
 * eine Sperre, die waehrend des Notfall-Refreshs (fetch-Gate) desselben
 * Roundtrips greift, unterdrueckt sowohl die Token-Ausgabe als auch den
 * Audit-Vermerk.
 */
const testEnv = env as unknown as Env;

const bot = () => testEnv.TOKEN_STORE.get(testEnv.TOKEN_STORE.idFromName('bot'));

/** Restlaufzeit knapp unter MIN_REMAINING_MS (15 Min) — loest einen Notfall-Refresh aus. */
const almostExpiredPair = (accessToken: string, refreshToken: string) => ({
  accessToken,
  refreshToken,
  expiresAt: Date.now() + 5 * 60 * 1000,
});

const freshPair = (accessToken: string, refreshToken: string) => ({
  accessToken,
  refreshToken,
  expiresAt: Date.now() + 4 * 3600 * 1000,
});

beforeEach(async () => {
  await runInDurableObject(bot(), async (_instance: TokenStore, state) => state.storage.deleteAll());
});

afterEach(async () => {
  await runInDurableObject(bot(), async (_instance: TokenStore, state) => state.storage.deleteAll());
});

describe('TokenStore.getAccessTokenForLogin closes the recordLogin-after-decision window (infrastructure-k2f7w)', () => {
  it('withholds the token AND does not record the login when locked during the same roundtrip as issuance', async () => {
    const result = await runInDurableObject(bot(), async (instance: TokenStore) => {
      await instance.storeAuthorization(almostExpiredPair('ghu_old', 'refresh-ok'));
      const realFetch = globalThis.fetch;
      let entered!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => { entered = resolve; });
      const gate = new Promise<void>((resolve) => { release = resolve; });
      globalThis.fetch = (async () => {
        entered();
        await gate;
        return Response.json({ access_token: 'ghu_fresh', refresh_token: 'refresh-fresh', expires_in: 28800 });
      }) as typeof fetch;
      try {
        const pending = instance.getAccessTokenForLogin('client-id', 'user@example.com', Date.now());
        await started;
        // Sperre greift waehrend des Notfall-Refreshs desselben Roundtrips —
        // exakt das enge Fenster, das frueher zwischen den zwei getrennten
        // Aufrufen (getAccessToken / recordLogin) offen war.
        await instance.updateSettings({ loginDisabled: true });
        release();
        return await pending;
      } finally {
        release();
        globalThis.fetch = realFetch;
      }
    });

    expect(result).toEqual({ ok: false, reason: 'login_disabled' });

    const users = await runInDurableObject(bot(), (instance: TokenStore) => instance.listUsers());
    expect(users).toEqual([]);
  });

  it('still issues a token AND records the login for a regular, unlocked login', async () => {
    const [result, users] = await runInDurableObject(bot(), async (instance: TokenStore) => {
      await instance.storeAuthorization(freshPair('ghu_bot_token', 'refresh-ok'));
      const tokenResult = await instance.getAccessTokenForLogin('client-id', 'user@example.com', Date.now());
      return [tokenResult, await instance.listUsers()] as const;
    });

    expect(result).toEqual({ ok: true, token: 'ghu_bot_token' });
    expect(users).toHaveLength(1);
    expect(users[0]?.email).toBe('user@example.com');
  });
});
