import { isAllowedDomain, loadConfig } from '../config.js';
import {
  renderMissingConfigPage,
  renderNoAllowedDomainsPage,
  renderSelectionPage,
  renderSetupIncompletePage,
  renderUnsupportedDomainPage,
} from '../pages.js';
import { pickTexts } from '../texts.js';
import type { Env } from '../types.js';

/**
 * Baut die Upstream-`/auth`-URL: uebernimmt alle Query-Parameter des
 * eingehenden `/auth`-Requests (u. a. `site_id`), ergaenzt `provider=github`
 * falls fehlend, und toleriert eine `GITHUB_AUTH_URL`-Basis mit/ohne
 * abschliessenden Slash oder `/auth` (verschoben aus dem entfallenen
 * `routes/github-relay.ts`, ADR 0017-Nachtrag — Mechanik unveraendert).
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

/**
 * `GET /auth` — Eingangs-Gate (NFR-1) auf den `site_id`-Parameter, danach
 * entweder Auswahlseite (E-Mail + GitHub-Delegation, ADR 0001/0017) oder
 * Direkt-Redirect auf `/auth/access` (E-Mail-only). Der GitHub-Weg bettet den
 * Doppel-Handshake direkt in die Auswahl-Seite ein (Ein-Klick-Login,
 * ADR 0017-Nachtrag) — es gibt keine separate `/auth/github`-Zwischenseite
 * mehr.
 */
export async function handleAuth(request: Request, env: Env): Promise<Response> {
  const t = pickTexts(request.headers.get('accept-language'));
  const config = await loadConfig(env);

  if (!config.ok) {
    return renderMissingConfigPage(config, t);
  }

  if (config.accessAppAud === undefined || config.githubAppClientId === undefined) {
    return renderSetupIncompletePage(t);
  }

  if (config.allowedDomains.length === 0) {
    return renderNoAllowedDomainsPage(t);
  }

  const url = new URL(request.url);
  const siteId = url.searchParams.get('site_id') ?? '';

  if (!isAllowedDomain(siteId, config.allowedDomains)) {
    return renderUnsupportedDomainPage(t);
  }

  const accessUrl = new URL('/auth/access', url.origin);
  url.searchParams.forEach((value, key) => accessUrl.searchParams.set(key, value));

  if (config.githubAuthUrl) {
    // GitHub-Button bettet den Doppel-Handshake direkt ein (ADR 0001/0017):
    // ein Klick oeffnet den Upstream als zweites Popup auf DESSEN Origin
    // statt fremdes HTML durchzureichen oder ueber eine Zwischenseite zu
    // navigieren.
    const upstreamAuthUrl = buildUpstreamAuthUrl(config.githubAuthUrl, url);
    const upstreamOrigin = new URL(config.githubAuthUrl).origin;

    return renderSelectionPage(
      { upstreamAuthUrl, upstreamOrigin, allowedDomains: config.allowedDomains },
      accessUrl.toString(),
      siteId,
      t,
    );
  }

  return Response.redirect(accessUrl.toString(), 302);
}
