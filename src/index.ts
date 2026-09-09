import { loadConfig } from './config.js';
import { handleAuthAccess } from './routes/access.js';
import { handleAuth } from './routes/auth.js';
import { handleSetup } from './routes/setup.js';
import type { Env } from './types.js';

export { TokenStore } from './token-store.js';

/**
 * Ein `fetch`-Handler, `switch` ueber `URL.pathname`, ein Modul pro Route
 * (ADR 0008). Kein Router-Framework. Der `scheduled`-Handler rotiert das
 * Bot-Token um 0/6/12/18 Uhr UTC (ADR 0011): Er ist der einzige regulaere
 * Refresher (Single-Writer), Logins lesen nur.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === '/setup' || pathname.startsWith('/setup/')) {
      return handleSetup(request, env);
    }

    switch (pathname) {
      case '/auth':
        return request.method === 'GET' ? handleAuth(request, env) : methodNotAllowed(['GET']);

      case '/auth/access':
        return request.method === 'GET'
          ? handleAuthAccess(request, env)
          : methodNotAllowed(['GET']);

      default:
        return new Response('Not Found', { status: 404 });
    }
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const config = await loadConfig(env);

    if (!config.ok || config.githubAppClientId === undefined) {
      // Unkonfigurierter/noch nicht eingerichteter Worker: nichts zu rotieren.
      return;
    }

    const tokenStore = env.TOKEN_STORE.get(env.TOKEN_STORE.idFromName('bot'));

    // Ergebnis bewusst ignoriert: bei not_authorized/refresh_failed bleibt
    // das alte Paar liegen (siehe TokenStore.doRefresh) und der naechste
    // Tick bzw. der Login-Notfall-Refresh versucht es erneut.
    await tokenStore.rotate(config.githubAppClientId);
  },
} satisfies ExportedHandler<Env>;

function methodNotAllowed(allowed: string[]): Response {
  return new Response('Method Not Allowed', {
    status: 405,
    headers: { allow: allowed.join(', ') },
  });
}
