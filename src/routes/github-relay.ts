import type { LoadedConfig } from '../config.js';
import { renderGithubRelayPage } from '../pages.js';
import type { Texts } from '../texts.js';

/**
 * ADR 0017 (postMessage-Relay statt Durchreich-Proxy): `/auth/github` liefert
 * eine EIGENE Seite auf unserem Origin statt fremdes Upstream-HTML
 * durchzureichen. Sie oeffnet den Upstream (`sveltia-cms-auth`) erst nach
 * einem Klick (User-Geste) als zweites Popup auf DESSEN eigenem Origin; der
 * eigentliche Handshake laeuft im Client-Skript der Relay-Seite
 * (`renderGithubRelayPage`).
 */

/**
 * Baut die Upstream-`/auth`-URL: uebernimmt alle Query-Parameter des
 * eingehenden Requests (u. a. `site_id`), ergaenzt `provider=github` falls
 * fehlend, und toleriert eine `GITHUB_AUTH_URL`-Basis mit/ohne
 * abschliessenden Slash oder `/auth` (gleiche Toleranz wie der vormalige
 * Proxy).
 */
export function buildUpstreamAuthUrl(githubAuthUrl: string, requestUrl: URL): string {
  const target = new URL(githubAuthUrl);

  target.pathname = target.pathname.replace(/\/(auth)?\/?$/, '') + '/auth';
  target.search = requestUrl.search;

  if (!target.searchParams.has('provider')) {
    target.searchParams.set('provider', 'github');
  }

  return target.toString();
}

export function handleGithubRelay(request: Request, config: LoadedConfig, t: Texts): Response {
  const githubAuthUrl = config.githubAuthUrl;

  if (!githubAuthUrl) {
    return new Response('Not Found', { status: 404 });
  }

  const url = new URL(request.url);
  const siteId = url.searchParams.get('site_id') ?? '';
  const upstreamAuthUrl = buildUpstreamAuthUrl(githubAuthUrl, url);
  const upstreamOrigin = new URL(githubAuthUrl).origin;

  return renderGithubRelayPage(upstreamAuthUrl, upstreamOrigin, siteId, config.allowedDomains, t);
}
