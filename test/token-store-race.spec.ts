import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TokenStore } from '../src/token-store.js';
import type { Env } from '../src/types.js';

/**
 * Lifecycle-Race (Audit-Analogon zu ChatGPT A06, hier auf das SICHERE Soll
 * gedreht): Ein laufender Refresh haelt sein Ergebnis zurueck, waehrend ein
 * Disconnect bzw. eine neue Autorisierung dazwischenkommt. Der veraltete
 * Refresh darf danach weder den getrennten Zustand wiederherstellen noch das
 * frisch verbundene Konto ueberschreiben.
 */
const testEnv = env as unknown as Env;

const bot = () => testEnv.TOKEN_STORE.get(testEnv.TOKEN_STORE.idFromName('bot'));
const pair = (accessToken: string, refreshToken: string) => ({
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

describe('TokenStore lifecycle race', () => {
  it('a still-running refresh does not restore credentials after disconnect', async () => {
    const status = await runInDurableObject(bot(), async (instance: TokenStore) => {
      await instance.storeAuthorization(pair('ghu_old', 'refresh-ok'));
      const realFetch = globalThis.fetch;
      let entered!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => { entered = resolve; });
      const gate = new Promise<void>((resolve) => { release = resolve; });
      globalThis.fetch = (async () => {
        entered();
        await gate;
        return Response.json({ access_token: 'ghu_restored', refresh_token: 'refresh-restored', expires_in: 28800 });
      }) as typeof fetch;
      try {
        const pending = instance.rotate('client-id');
        await started;
        await instance.clearAuthorization();
        release();
        await pending;
        return await instance.status();
      } finally {
        release();
        globalThis.fetch = realFetch;
      }
    });

    expect(status.authorized).toBe(false);
    expect(status.accessToken).toBeNull();
  });

  it('an old in-flight refresh does not overwrite a newly connected account', async () => {
    const status = await runInDurableObject(bot(), async (instance: TokenStore) => {
      await instance.storeAuthorization(pair('ghu_old', 'refresh-ok'));
      const realFetch = globalThis.fetch;
      let entered!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => { entered = resolve; });
      const gate = new Promise<void>((resolve) => { release = resolve; });
      globalThis.fetch = (async () => {
        entered();
        await gate;
        return Response.json({ access_token: 'ghu_previous_account', refresh_token: 'refresh-previous', expires_in: 28800 });
      }) as typeof fetch;
      try {
        const pending = instance.rotate('client-id');
        await started;
        await instance.storeAuthorization(pair('ghu_new_account', 'refresh-new'));
        release();
        await pending;
        return await instance.status();
      } finally {
        release();
        globalThis.fetch = realFetch;
      }
    });

    expect(status.accessToken).toBe('ghu_new_account');
  });
});
