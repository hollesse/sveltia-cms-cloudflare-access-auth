import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TokenStore } from '../src/token-store.js';
import type { Env } from '../src/types.js';

/**
 * Device-Flow-Abschluss-Race (Reaudit R3, auth-g5h9j): Der `poll`-Handler
 * fragt GitHub extern ab, BEVOR er den Pending-Flow abschliesst. Kommt in
 * diesem Fenster ein Disconnect oder ein neu gestarteter Flow dazwischen,
 * darf die (dann veraltete) Antwort weder den getrennten Zustand
 * wiederherstellen noch den neuen Flow entfernen. Diese Tests simulieren das
 * Fenster deterministisch, indem sie die interleavende Operation VOR dem
 * (unbedingten bzw. atomaren) Abschluss ausfuehren — direkte DO-Aufrufe,
 * kein Reintervall noetig, da der Abschluss selbst keinen fetch enthaelt.
 */
const testEnv = env as unknown as Env;

const bot = () => testEnv.TOKEN_STORE.get(testEnv.TOKEN_STORE.idFromName('bot'));

const pair = (accessToken: string) => ({
  accessToken,
  refreshToken: `refresh-${accessToken}`,
  expiresAt: Date.now() + 8 * 3600 * 1000,
});
const account = (login: string) => ({ login, installations: 1 });

const flow = (overrides: Partial<{ txId: string; deviceCode: string }> = {}) => ({
  txId: 'tx-a',
  deviceCode: 'device-a',
  clientId: 'client-id',
  admin: 'admin@example.com',
  expiresAt: Date.now() + 15 * 60 * 1000,
  ...overrides,
});

beforeEach(async () => {
  await runInDurableObject(bot(), async (_instance: TokenStore, state) => state.storage.deleteAll());
});

afterEach(async () => {
  await runInDurableObject(bot(), async (_instance: TokenStore, state) => state.storage.deleteAll());
});

describe('device flow completion race (auth-g5h9j, R3)', () => {
  it('does not restore a disconnected account when a stale poll completes afterwards', async () => {
    const s = bot();
    const flowA = flow();
    await s.storePendingFlow(flowA);

    // Waehrend der externe GitHub-Poll fuer flowA noch lief, hat der Admin
    // getrennt (Disconnect entwertet Autorisierung + Pending-Flow).
    await s.clearAuthorization();

    // Die (jetzt veraltete) externe Antwort kommt zurueck: der atomare
    // Abschluss prueft den Pending-Flow erneut und weist ab, weil er
    // inzwischen geloescht wurde.
    const completed = await s.completePendingFlow(
      flowA.txId,
      flowA.clientId,
      flowA.admin,
      Date.now(),
      pair('ghu_should_not_land'),
      account('should-not-connect'),
    );

    expect(completed.ok).toBe(false);

    const status = await s.status();
    expect(status.authorized).toBe(false);
    expect(status.accessToken).toBeNull();
    expect(status.account).toBeNull();
  });

  it('leaves a replacing flow intact when a stale poll for the old flow completes later', async () => {
    const s = bot();
    const flowA = flow({ txId: 'tx-a', deviceCode: 'device-a' });
    await s.storePendingFlow(flowA);

    // Start B ersetzt die Pending-Transaktion, waehrend As externer Poll noch lief.
    const flowB = flow({ txId: 'tx-b', deviceCode: 'device-b' });
    await s.storePendingFlow(flowB);

    // As (veraltete) Antwort kommt zurueck: der atomare Abschluss vergleicht
    // gegen den DANN aktuellen Pending-Flow (B) und weist ab, statt B zu loeschen.
    const completed = await s.completePendingFlow(
      flowA.txId,
      flowA.clientId,
      flowA.admin,
      Date.now(),
      pair('ghu_from_a'),
      account('account-a'),
    );

    expect(completed.ok).toBe(false);

    const pending = await s.getPendingFlow();
    expect(pending?.txId).toBe(flowB.txId);
    expect((await s.status()).authorized).toBe(false);
  });
});
