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

  // Nutzer-Login deaktiviert (Wartung/Notfall): selbst mit gueltigem
  // Access-JWT wird kein Token herausgegeben (kein Tokenwert im Body) — sofort
  // wirksam, ohne auf Session- oder Token-Ablauf zu warten.
  if (config.loginDisabled) {
    return renderCallbackErrorPage(
      t.callbackError.loginDisabled,
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

  // Login-Historie (ADR 0015): E-Mail aus dem bereits kryptografisch
  // validierten Access-JWT. `getAccessTokenForLogin` fasst Ausgabeentscheidung
  // und Audit-Vermerk in EINEM DO-Roundtrip zusammen (infrastructure-k2f7w) —
  // sonst koennte eine Sperre exakt zwischen zwei getrennten Aufrufen greifen,
  // ohne die bereits getroffene Ausgabeentscheidung noch einzuholen.
  const email = typeof validation.payload['email'] === 'string' ? validation.payload['email'] : '';
  const tokenResult = await tokenStore.getAccessTokenForLogin(config.githubAppClientId, email, Date.now());

  if (!tokenResult.ok) {
    // Reaudit R2 (auth-f2t6w): der Login-Refresh kann NACH dem obigen
    // fruehen `loginDisabled`-Check gesperrt worden sein (Race waehrend eines
    // laufenden Notfall-Refreshs) — derselbe Fehlertext/Status wie der
    // fruehe Check, unabhaengig davon, WANN die Sperre gegriffen hat.
    if (tokenResult.reason === 'login_disabled') {
      return renderCallbackErrorPage(t.callbackError.loginDisabled, config.allowedDomains, t, 503);
    }

    return renderCallbackErrorPage(
      tokenResult.reason === 'not_authorized'
        ? t.callbackError.notConnected
        : t.callbackError.githubFailed,
      config.allowedDomains,
      t,
    );
  }

  return renderCallbackSuccessPage(
    { provider: 'github', token: tokenResult.token },
    config.allowedDomains,
    t,
  );
}
