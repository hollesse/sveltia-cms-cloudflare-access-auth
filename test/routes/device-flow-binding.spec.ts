import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TokenStore } from '../../src/token-store.js';
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

function bot() {
  return testEnv.TOKEN_STORE.get(testEnv.TOKEN_STORE.idFromName('bot'));
}

function botAuthorized(): Promise<boolean> {
  return bot().status().then((s) => s.authorized);
}

/**
 * Simuliert eine Interleaving-Operation (Disconnect / neuer Start) GENAU im
 * Fenster zwischen dem Pre-Check (`getPendingFlow`, `src/routes/setup.ts`)
 * und dem atomaren Abschluss (`completePendingFlow`) — exakt das Fenster, in
 * dem in Produktion GitHubs Tokenendpoint-Roundtrip haengt (Reaudit R3,
 * auth-g5h9j, Abläufe 2+3). Zwei technische Sackgassen fuehrten hierher:
 *
 * 1. `globalThis.fetch` in diesem Testfile gaten (Idiom aus
 *    `test/token-store-race.spec.ts`) UND von aussen (per `SELF.fetch`
 *    ausserhalb des Gates) freigeben funktioniert zwar (Globals sind
 *    geteilt), aber sobald die Fortsetzung durch ein extern (aus einem
 *    ANDEREN Promise-Kontext) aufgeloestes Gate wieder anlaeuft, verliert
 *    der Cloudflare-Workers-Laufzeit-Tracker den zugehoerigen IoContext:
 *    jede danach neu erzeugte I/O (ein neuer `fetch()`, ein Response-Body)
 *    wirft "Cannot perform I/O on behalf of a different request".
 * 2. Eine Instanz-Methode direkt patchen (`instance.getPendingFlow = ...`,
 *    via `runInDurableObject`) laesst das DO-RPC mit "The RPC receiver does
 *    not implement the method" scheitern — Cloudflares DO-RPC erkennt nur
 *    Methoden auf dem PROTOTYPEN als aufrufbar, keine Instanz-Properties.
 *
 * Der Patch sitzt daher auf `TokenStore.prototype` (eine normale JS-Klasse,
 * kein gefrorenes ESM-Exportobjekt) und wird NACH dem echten Pre-Check-Read
 * ausgefuehrt — innerhalb der EIGENEN Promise-Kette des `poll`-Requests,
 * ohne fremd aufgeloeste Promises, also ohne IoContext-Verlust. Restauriert
 * sich selbst nach dem ersten Treffer; `restore()` sichert zusaetzlich ab.
 */
function interleaveOnNextPendingFlowRead(
  sideEffect: (store: TokenStore) => Promise<void>,
): { restore: () => void } {
  const original = TokenStore.prototype.getPendingFlow;

  TokenStore.prototype.getPendingFlow = async function (this: TokenStore) {
    const value = await original.call(this);
    TokenStore.prototype.getPendingFlow = original;
    await sideEffect(this);
    return value;
  };

  return { restore: () => { TokenStore.prototype.getPendingFlow = original; } };
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

describe('disconnect invalidates a previously started device flow (auth-g5h9j, R3a)', () => {
  it('rejects a poll with a valid old txId after the admin disconnected in between', async () => {
    const headers = await authedHeaders();
    const started = await start(headers);

    const disconnected = await SELF.fetch(`${ORIGIN}/setup/github/disconnect`, {
      method: 'POST',
      headers,
    });
    expect(disconnected.status).toBe(200);

    const response = await poll(headers, { txId: started.txId });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, reason: 'unknown_transaction' });
    expect(await botAuthorized()).toBe(false);
  });
});

describe('a poll already in flight at the GitHub token endpoint is rejected on completion (auth-g5h9j, R3b/R3c)', () => {
  it('rejects a stale poll that was in flight when the admin disconnected, storing nothing (Ablauf 2)', async () => {
    const headers = await authedHeaders();
    const started = await start(headers);
    const txId = started.txId as string;

    // Der Standard-Device-Code ('device-ok') laesst den Mock-Upstream ein
    // erfolgreiches Token-Paar liefern (vitest.config.mts) — der Poll waere
    // ohne Interleaving ein Happy Path. Der Disconnect passiert direkt nach
    // dem Pre-Check-Read, simuliert also den Fall, dass GitHubs Antwort erst
    // NACH dem Disconnect zurueckkommt.
    const interleave = interleaveOnNextPendingFlowRead(async (store) => {
      await store.clearAuthorization();
    });

    try {
      const response = await poll(headers, { txId });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ ok: false, reason: 'unknown_transaction' });

      const status = await bot().status();
      expect(status.authorized).toBe(false);
      expect(status.accessToken).toBeNull();
      expect(status.account).toBeNull();
    } finally {
      interleave.restore();
    }
  });

  it('rejects a stale poll for a flow that was replaced by a new start, leaving the new flow intact (Ablauf 3)', async () => {
    const headers = await authedHeaders();
    const startedA = await start(headers);
    const txIdA = startedA.txId as string;
    const txIdB = crypto.randomUUID();

    // Start B ersetzt die Pending-Transaktion direkt nach dem Pre-Check-Read
    // fuer As Poll — simuliert, dass ein neuer Flow gestartet wurde, waehrend
    // As externer Poll noch lief. `device-pending` laesst den Mock-Upstream
    // deterministisch `authorization_pending` liefern (vitest.config.mts),
    // damit ein spaeterer Poll fuer B `pending` zurueckgibt statt sofort
    // abzuschliessen.
    const interleave = interleaveOnNextPendingFlowRead(async (store) => {
      await store.storePendingFlow({
        txId: txIdB,
        deviceCode: 'device-pending',
        clientId: 'client-pending',
        admin: 'admin@example.com',
        expiresAt: Date.now() + 15 * 60 * 1000,
      });
    });

    try {
      const responseA = await poll(headers, { txId: txIdA });

      expect(responseA.status).toBe(400);
      expect(await responseA.json()).toMatchObject({ ok: false, reason: 'unknown_transaction' });
      expect(await botAuthorized()).toBe(false);

      // Bs Transaktion ist unangetastet: ein echter Poll dafuer liefert noch
      // `pending`, nicht `unknown_transaction` — B wurde also nicht mit
      // entfernt (Client-ID auf Bs Wert stellen, damit die Route ihn erkennt).
      Object.assign(testEnv, { GITHUB_APP_CLIENT_ID: 'client-pending' });
      const responseB = await poll(headers, { txId: txIdB });

      expect(responseB.status).toBe(200);
      expect(await responseB.json()).toMatchObject({ ok: false, reason: 'pending' });

      const pending = await bot().getPendingFlow();
      expect(pending?.txId).toBe(txIdB);
    } finally {
      interleave.restore();
    }
  });
});
