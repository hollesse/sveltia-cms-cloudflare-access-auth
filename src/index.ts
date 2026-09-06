import { isAllowedDomain, loadConfig } from './config.js';
import { handleAuthAccess } from './routes/access.js';
import { handleAuth } from './routes/auth.js';
import { handleGithubProxy } from './routes/github-proxy.js';
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

      case '/auth/github':
      case '/callback': {
        if (request.method !== 'GET') {
          return methodNotAllowed(['GET']);
        }

        const config = await loadConfig(env);

        // Offenes-Relay-Schutz (ADR 0014): ohne mindestens eine erlaubte
        // Domain bleibt der GitHub-Proxy gesperrt — gleiches Verhalten wie
        // vor der Settings-im-DO-Umstellung (no_allowed_domains -> 404).
        if (!config.ok || config.allowedDomains.length === 0) {
          return new Response('Not Found', { status: 404 });
        }

        // Eingangs-Gate am Einstieg: `site_id` muss eine erlaubte Domain sein,
        // bevor irgendetwas nach aussen geht (wie `/auth`). Nur am `/auth/github`-
        // Einstieg — der `/callback` traegt keinen vertrauenswuerdigen `site_id`
        // (GitHub kontrolliert den Redirect) und bleibt am Upstream-Origin-Check.
        if (pathname === '/auth/github') {
          const siteId = new URL(request.url).searchParams.get('site_id') ?? '';

          if (!isAllowedDomain(siteId, config.allowedDomains)) {
            return new Response('Not Found', { status: 404 });
          }
        }

        return handleGithubProxy(request, config);
      }

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
