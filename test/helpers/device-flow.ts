import { SELF } from 'cloudflare:test';

/**
 * Treibt den Device Flow über den txId-Vertrag: startet den Flow
 * mit den übergebenen Admin-Headern und pollt anschließend mit der vom Server
 * zurückgegebenen opaquen `txId`. Der rohe `device_code` wird nie berührt.
 * Gibt die Poll-Response zurück (das Ergebnis — ok / pending / Fehler — steuern
 * Tests über die `GITHUB_APP_CLIENT_ID`, siehe Mock in `vitest.config.mts`).
 */
export async function connectBot(
  origin: string,
  headers: Record<string, string>,
): Promise<Response> {
  const started = (await (
    await SELF.fetch(`${origin}/setup/github/start`, { method: 'POST', headers })
  ).json()) as { txId?: string };

  return SELF.fetch(`${origin}/setup/github/poll`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ txId: started.txId }),
  });
}
