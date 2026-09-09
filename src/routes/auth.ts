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
 * `GET /auth` — Eingangs-Gate (NFR-1) auf den `site_id`-Parameter, danach
 * entweder Auswahlseite (E-Mail + GitHub-Delegation, ADR 0001) oder
 * Direkt-Redirect auf `/auth/access` (E-Mail-only).
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
    // GitHub-Button zeigt auf UNSEREN Relay-Einstieg (ADR 0001/0017): eine
    // eigene Seite auf unserem Origin, die den Upstream als zweites Popup
    // auf DESSEN Origin oeffnet statt fremdes HTML durchzureichen.
    const githubUrl = new URL('/auth/github', url.origin);
    url.searchParams.forEach((value, key) => githubUrl.searchParams.set(key, value));

    return renderSelectionPage(githubUrl.toString(), accessUrl.toString(), siteId, t);
  }

  return Response.redirect(accessUrl.toString(), 302);
}
