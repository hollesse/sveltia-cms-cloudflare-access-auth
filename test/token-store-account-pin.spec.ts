import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AccountInfo, TokenStore } from '../src/token-store.js';
import type { Env } from '../src/types.js';

/**
 * Konto-Pin (Reaudit R5, auth-p6d2c): `completePendingFlow` prueft die
 * `accountId` des neu verifizierten Kontos GEGEN ein bereits gespeichertes
 * Konto — weicht sie ab, wird der Abschluss abgewiesen (`account_mismatch`),
 * OHNE etwas zu ueberschreiben. Ein gewollter Kontowechsel laeuft
 * ausschliesslich ueber Disconnect (loescht Konto + Pin) + neuen Device Flow.
 * Altbestand OHNE gespeicherte `accountId` (vor diesem Fix verbunden) hat
 * noch keinen Pin.
 */
const testEnv = env as unknown as Env;

const bot = () => testEnv.TOKEN_STORE.get(testEnv.TOKEN_STORE.idFromName('bot'));

const pair = (accessToken: string) => ({
  accessToken,
  refreshToken: `refresh-${accessToken}`,
  expiresAt: Date.now() + 8 * 3600 * 1000,
});

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

describe('account pin on device flow completion (auth-p6d2c, R5)', () => {
  it('rejects completion with a different accountId than the stored account, keeping the stored account and token', async () => {
    const s = bot();
    const accountA: AccountInfo = { login: 'account-a', accountId: 1, installations: 1 };
    const flowA = flow({ txId: 'tx-a', deviceCode: 'device-a' });
    await s.storePendingFlow(flowA);

    const firstCompletion = await s.completePendingFlow(
      flowA.txId,
      flowA.clientId,
      flowA.admin,
      Date.now(),
      pair('ghu_a'),
      accountA,
    );
    expect(firstCompletion.ok).toBe(true);

    // Reconnect OHNE Disconnect: gleiche Admin-Session/Client-ID, aber das
    // verifizierte Konto ist ein ANDERES (accountId 2 statt 1).
    const flowB = flow({ txId: 'tx-b', deviceCode: 'device-b' });
    await s.storePendingFlow(flowB);
    const accountB: AccountInfo = { login: 'account-b', accountId: 2, installations: 3 };

    const secondCompletion = await s.completePendingFlow(
      flowB.txId,
      flowB.clientId,
      flowB.admin,
      Date.now(),
      pair('ghu_b'),
      accountB,
    );

    expect(secondCompletion).toEqual({ ok: false, reason: 'account_mismatch' });

    const status = await s.status();
    expect(status.account).toEqual(accountA);
    expect(status.accessToken).toBe('ghu_a');
  });

  it('accepts completion when the accountId matches the stored account (token refresh / re-authorization of the same bot)', async () => {
    const s = bot();
    const account: AccountInfo = { login: 'account-a', accountId: 1, installations: 1 };
    const flowA = flow({ txId: 'tx-a', deviceCode: 'device-a' });
    await s.storePendingFlow(flowA);
    await s.completePendingFlow(flowA.txId, flowA.clientId, flowA.admin, Date.now(), pair('ghu_a'), account);

    const flowB = flow({ txId: 'tx-b', deviceCode: 'device-b' });
    await s.storePendingFlow(flowB);
    const sameAccountAgain: AccountInfo = { login: 'account-a', accountId: 1, installations: 2 };

    const completion = await s.completePendingFlow(
      flowB.txId,
      flowB.clientId,
      flowB.admin,
      Date.now(),
      pair('ghu_b'),
      sameAccountAgain,
    );

    expect(completion).toEqual({ ok: true });
    const status = await s.status();
    expect(status.account).toEqual(sameAccountAgain);
    expect(status.accessToken).toBe('ghu_b');
  });

  it('accepts completion when no account is stored yet (first-time connect)', async () => {
    const s = bot();
    const flowA = flow();
    await s.storePendingFlow(flowA);
    const account: AccountInfo = { login: 'account-a', accountId: 1, installations: 1 };

    const completion = await s.completePendingFlow(
      flowA.txId,
      flowA.clientId,
      flowA.admin,
      Date.now(),
      pair('ghu_a'),
      account,
    );

    expect(completion).toEqual({ ok: true });
  });

  it('does not pin a legacy account stored without an accountId (pre-auth-p6d2c)', async () => {
    const s = bot();

    // Altbestand: vor diesem Fix serialisierte `AccountInfo` ohne `accountId` —
    // direkt in den Storage geschrieben, da das aktuelle Typ-Interface das
    // Feld verlangt.
    await runInDurableObject(s, async (_instance, state) => {
      await state.storage.put('account:v1', { login: 'legacy-account', installations: 2 });
    });

    const flowA = flow();
    await s.storePendingFlow(flowA);
    const newAccount: AccountInfo = { login: 'new-account', accountId: 99, installations: 1 };

    const completion = await s.completePendingFlow(
      flowA.txId,
      flowA.clientId,
      flowA.admin,
      Date.now(),
      pair('ghu_new'),
      newAccount,
    );

    expect(completion).toEqual({ ok: true });
    const status = await s.status();
    expect(status.account).toEqual(newAccount);
  });
});
