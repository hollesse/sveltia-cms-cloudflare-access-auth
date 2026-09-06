/**
 * Minimale eigene Ambient-Deklaration fuer `cloudflare:test`
 * (`@cloudflare/vitest-pool-workers`, ADR 0006). Das Paket erwartet fuer
 * vollen Typkomfort eine projekteigene `worker-configuration.d.ts`
 * (`wrangler types`); fuer diese Tests reicht die schmale Teilmenge, die
 * tatsaechlich genutzt wird.
 */
declare module 'cloudflare:test' {
  import type { Env } from '../src/types.js';

  export const env: Env & Record<string, unknown>;
  export const SELF: { fetch: typeof fetch };

  export function runInDurableObject<O extends object, R>(
    stub: DurableObjectStub<O>,
    callback: (instance: O, state: DurableObjectState) => R | Promise<R>,
  ): Promise<R>;
}
