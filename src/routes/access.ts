import { validateAccessJwt } from '../access-jwt.js';
import { isAllowedDomain, loadConfig } from '../config.js';
import {
  renderAccessUnauthorizedPage,
  renderCallbackErrorPage,
  renderCallbackSuccessPage,
  renderMissingConfigPage,
  renderNoAllowedDomainsPage,
  renderUnsupportedDomainPage,
} from '../pages.js';
import { pickTexts } from '../texts.js';
import type { Env } from '../types.js';

/**
 * `GET /auth/access` — validiert das Cloudflare-Access-JWT kryptographisch
 * (jose/JWKS, aud/iss/exp/alg), holt das kurzlebige GitHub-App-User-Token
 * des Bot-Accounts aus dem TokenStore-Durable-Object (ADR 0011) und liefert
 * die postMessage-Antwortseite. Reine Header-Anwesenheit wird nie als
 * Nachweis akzeptiert (T-5-Vorlaeufer).
 *
 * Verlangt IMMER ein bekanntes AUD (DO-Setting oder Env-Fallback, ADR 0014):
 * ohne AUD/Client-ID wird die Anmeldung ohne JWT-Pruefung verweigert
 * ("Einrichtung unvollstaendig") — nie unsicherer Betrieb ohne Audience-Pin,
 * und das Popup haengt dank des bestehenden postMessage-Fehlerformats nie.
 */
export async function handleAuthAccess(request: Request, env: Env): Promise<Response> {
  const t = pickTexts(request.headers.get('accept-language'));
  const config = await loadConfig(env);

  if (!config.ok) {
    return renderMissingConfigPage(config, t);
  }

  if (config.accessAppAud === undefined || config.githubAppClientId === undefined) {
    return renderCallbackErrorPage(t.callbackError.setupIncomplete, config.allowedDomains, t);
  }

  if (config.allowedDomains.length === 0) {
    return renderNoAllowedDomainsPage(t);
  }

  const validation = await validateAccessJwt(request, config.accessTeamDomain, config.accessAppAud);

  if (!validation.ok) {
    return renderAccessUnauthorizedPage(t);
  }

  // Notfall-Kill-Switch: ist die Token-Ausgabe gesperrt, wird selbst mit
  // gueltigem Access-JWT kein Token herausgegeben (kein Tokenwert im Body) —
  // sofort wirksam, ohne auf Session- oder Token-Ablauf zu warten.
  if (config.tokenIssuanceDisabled) {
    return renderCallbackErrorPage(
      t.callbackError.issuanceDisabled,
      config.allowedDomains,
      t,
      503,
    );
  }

  const url = new URL(request.url);
  const siteId = url.searchParams.get('site_id') ?? '';

  // Eingangs-Gate (NFR-1) fuer den site_id-Parameter dieser Route — konsistent
  // zu `/auth`: ein fehlender oder nicht erlaubter `site_id` wird abgelehnt (kein
  // stilles Ueberspringen). Das eigentliche Token-Uebergabe-Gate bleibt der
  // exakte postMessage-Empfaenger-Origin-Check in der Antwortseite.
  if (!isAllowedDomain(siteId, config.allowedDomains)) {
    return renderUnsupportedDomainPage(t);
  }

  const tokenStore = env.TOKEN_STORE.get(env.TOKEN_STORE.idFromName('bot'));
  const tokenResult = await tokenStore.getAccessToken(config.githubAppClientId);

  if (!tokenResult.ok) {
    return renderCallbackErrorPage(
      tokenResult.reason === 'not_authorized'
        ? t.callbackError.notConnected
        : t.callbackError.githubFailed,
      config.allowedDomains,
      t,
    );
  }

  // Login-Historie vermerken (ADR 0015): E-Mail aus dem bereits kryptografisch
  // validierten Access-JWT. Fehler hier duerfen den Login nie blockieren.
  const email = typeof validation.payload['email'] === 'string' ? validation.payload['email'] : '';
  if (email !== '') {
    try {
      await tokenStore.recordLogin(email, Date.now());
    } catch {
      // Audit-Log ist best-effort; ein Fehler darf die Anmeldung nicht stoppen.
    }
  }

  return renderCallbackSuccessPage(
    { provider: 'github', token: tokenResult.token },
    config.allowedDomains,
    t,
  );
}
