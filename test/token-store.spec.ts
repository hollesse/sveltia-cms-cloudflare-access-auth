import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { TokenStore } from '../src/token-store.js';

const stub = (name: string) => env.TOKEN_STORE.get(env.TOKEN_STORE.idFromName(name));

const seed = (
  instance: TokenStore,
  pair: { accessToken: string; expiresAt: number; refreshToken: string },
) => instance.storeAuthorization(pair);

describe('TokenStore', () => {
  it('reports not_authorized before setup', async () => {
    expect(await stub('t1').getAccessToken('client-id')).toEqual({
      ok: false,
      reason: 'not_authorized',
    });
  });

  it('returns the cached access token while it is fresh (no refresh)', async () => {
    const s = stub('t2');

    await runInDurableObject(s, (instance: TokenStore) =>
      seed(instance, {
        accessToken: 'ghu_cached',
        expiresAt: Date.now() + 4 * 3600 * 1000,
        refreshToken: 'refresh-dead', // wuerde beim (unerwuenschten) Refresh scheitern
      }),
    );

    expect(await s.getAccessToken('client-id')).toEqual({ ok: true, token: 'ghu_cached' });
  });

  it('self-heals with an emergency refresh when the cached token is stale', async () => {
    const s = stub('t3');

    await runInDurableObject(s, (instance: TokenStore) =>
      seed(instance, {
        accessToken: 'ghu_stale',
        expiresAt: Date.now() + 60 * 1000, // unter der 15-min-Schwelle
        refreshToken: 'refresh-ok',
      }),
    );

    expect(await s.getAccessToken('client-id')).toEqual({ ok: true, token: 'ghu_fresh_token' });

    const status = await s.status();

    expect(status.authorized).toBe(true);
    expect(status.expiresAt).toBeGreaterThan(Date.now() + 7 * 3600 * 1000);
  });

  it('rotate refreshes unconditionally and stores the rotated pair', async () => {
    const s = stub('t4');

    await runInDurableObject(s, (instance: TokenStore) =>
      seed(instance, {
        accessToken: 'ghu_old',
        expiresAt: Date.now() + 7 * 3600 * 1000,
        refreshToken: 'refresh-ok',
      }),
    );

    expect(await s.rotate('client-id')).toEqual({ ok: true, token: 'ghu_fresh_token' });
  });

  it('keeps the old pair on refresh failure (transient GitHub errors)', async () => {
    const s = stub('t5');
    const expiresAt = Date.now() + 7 * 3600 * 1000;

    await runInDurableObject(s, (instance: TokenStore) =>
      seed(instance, { accessToken: 'ghu_old', expiresAt, refreshToken: 'refresh-dead' }),
    );

    expect(await s.rotate('client-id')).toEqual({ ok: false, reason: 'refresh_failed' });

    // Altes Paar unangetastet: Login funktioniert weiter, solange es gilt.
    expect(await s.getAccessToken('client-id')).toEqual({ ok: true, token: 'ghu_old' });
  });
});

describe('TokenStore settings (ADR 0014)', () => {
  it('reports an empty object before any setting is stored', async () => {
    expect(await stub('settings-1').getSettings()).toEqual({});
  });

  it('merges a partial update into the existing settings', async () => {
    const s = stub('settings-2');

    await s.updateSettings({ accessAppAud: 'pinned-aud' });
    const afterFirst = await s.updateSettings({ githubAppClientId: 'Iv1.client' });

    expect(afterFirst).toEqual({ accessAppAud: 'pinned-aud', githubAppClientId: 'Iv1.client' });
    expect(await s.getSettings()).toEqual(afterFirst);
  });

  it('overwrites a previously set value on a later update', async () => {
    const s = stub('settings-3');

    await s.updateSettings({ allowedDomains: ['old.example.com'] });
    await s.updateSettings({ allowedDomains: ['new.example.com'] });

    expect(await s.getSettings()).toEqual({ allowedDomains: ['new.example.com'] });
  });
});
