import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TokenStore } from '../src/token-store.js';
import type { Env } from '../src/types.js';

/**
 * Reaudit R2 (auth-f2t6w): ein Login, dessen Notfall-Refresh erst NACH einer
 * bestaetigten Sperrung antwortet, darf trotz frischem Token keinen Token mehr
 * ausgeben. Settings (`loginDisabled`) leben im selben DO — die
 * Ausgabeentscheidung muss also nach allen Awaits, unmittelbar vor der
 * Rueckgabe, erneut gegen den DANN aktuellen Zustand pruefen. Gate-Idiom aus
 * `test/token-store-race.spec.ts`.
 */
const testEnv = env as unknown as Env;

const bot = () => testEnv.TOKEN_STORE.get(testEnv.TOKEN_STORE.idFromName('bot'));

/** Restlaufzeit knapp unter MIN_REMAINING_MS (15 Min) — loest einen Notfall-Refresh aus. */
const almostExpiredPair = (accessToken: string, refreshToken: string) => ({
  accessToken,
  refreshToken,
  expiresAt: Date.now() + 5 * 60 * 1000,
});

beforeEach(async () => {
  await runInDurableObject(bot(), async (_instance: TokenStore, state) => state.storage.deleteAll());
});

afterEach(async () => {
  await runInDurableObject(bot(), async (_instance: TokenStore, state) => state.storage.deleteAll());
});

describe('TokenStore withholds tokens once locked mid-refresh (Reaudit R2, auth-f2t6w)', () => {
  it('returns login_disabled instead of a fresh token when locked while the refresh is in flight', async () => {
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
        const pending = instance.getAccessToken('client-id');
        await started;
        await instance.updateSettings({ loginDisabled: true });
        release();
        return await pending;
      } finally {
        release();
        globalThis.fetch = realFetch;
      }
    });

    expect(result).toEqual({ ok: false, reason: 'login_disabled' });
  });

  it('still stores the refreshed pair (self-healing/rotation unaffected by the withheld return)', async () => {
    const status = await runInDurableObject(bot(), async (instance: TokenStore) => {
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
        const pending = instance.getAccessToken('client-id');
        await started;
        await instance.updateSettings({ loginDisabled: true });
        release();
        await pending;
        return await instance.status();
      } finally {
        release();
        globalThis.fetch = realFetch;
      }
    });

    expect(status.accessToken).toBe('ghu_fresh');
  });

  it('cron rotation is unaffected by a locked login and still stores the rotated pair', async () => {
    const status = await runInDurableObject(bot(), async (instance: TokenStore) => {
      await instance.storeAuthorization(almostExpiredPair('ghu_old', 'refresh-ok'));
      await instance.updateSettings({ loginDisabled: true });
      const result = await instance.rotate('client-id');
      expect(result).toEqual({ ok: true, token: 'ghu_fresh_token' });
      return await instance.status();
    });

    expect(status.accessToken).toBe('ghu_fresh_token');
  });
});
