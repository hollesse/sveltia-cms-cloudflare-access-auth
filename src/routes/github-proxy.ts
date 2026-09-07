import type { LoadedConfig } from '../config.js';
import { PROXY_SECURITY_HEADERS } from '../pages.js';

/**
 * Option C aus REQUIREMENTS §7.6 (Zwei-Origin-Problem): Der GitHub-Weg wird
 * an ein unveraendertes, extern deploytes `sveltia-cms-auth` delegiert,
 * indem unser Worker dessen OAuth-Strecke DURCHREICHT statt weiterzuleiten.
 * Grund: (a) Sveltias postMessage-Origin-Check akzeptiert nur den
 * `base_url`-Origin (Research zwei-origin-handshake, Option A tot);
 * (b) `sveltia-cms-auth` bindet sein CSRF-`state` an ein Cookie — Einstieg
 * UND Callback muessen daher ueber denselben (unseren) Origin laufen, damit
 * das Cookie im Browser auf unserer Domain lebt. Die Callback-URL der
 * GitHub-OAuth-App zeigt entsprechend auf UNSEREN `/callback`.
 *
 *   GET /auth/github  →  <GITHUB_AUTH_URL>/auth?…      (Start, setzt csrf-Cookie,
 *                                                       302 zu github.com)
 *   GET /callback     →  <GITHUB_AUTH_URL>/callback?…  (Code-Tausch, liefert
 *                                                       postMessage-Seite)
 *
 * Durchgereicht werden nur die dafuer noetigen Header (Cookie hin,
 * Set-Cookie/Location/Content-Type zurueck); Redirects gehen unveraendert
 * an den Browser (redirect: 'manual').
 */

const PATH_MAP: Record<string, string> = {
  '/auth/github': '/auth',
  '/callback': '/callback',
};

/**
 * Cookie-Allowlist des Proxys: NUR der CSRF-state-Cookie von `sveltia-cms-auth`
 * — `csrf-token` (gegen den Upstream-Quellcode verifiziert) — darf den Proxy
 * passieren, in BEIDE Richtungen. Der Proxy teilt sich den Origin mit `/setup`;
 * ohne diese Grenze ginge die Cloudflare-Access-Identitaet (`CF_Authorization`)
 * an den Upstream, und ein (kompromittierter) Upstream koennte im Admin-Origin
 * ein Access-/Fremd-Cookie setzen oder ueberschreiben.
 */
const PROXIED_COOKIE_NAMES = ['csrf-token'];

/** Cookie-Name aus einem `name=value`-Paar (Vergleich case-insensitiv). */
function cookieName(pair: string): string {
  const eq = pair.indexOf('=');
  return (eq === -1 ? pair : pair.slice(0, eq)).trim().toLowerCase();
}

/** Filtert einen `Cookie`-Request-Header auf die erlaubten Namen. */
function filterRequestCookies(header: string): string {
  return header
    .split(';')
    .map((pair) => pair.trim())
    .filter((pair) => pair !== '' && PROXIED_COOKIE_NAMES.includes(cookieName(pair)))
    .join('; ');
}

/** Prueft, ob ein `Set-Cookie`-Header einen erlaubten Cookie setzt. */
function isProxiedSetCookie(setCookie: string): boolean {
  const firstPair = setCookie.split(';', 1)[0] ?? '';
  return PROXIED_COOKIE_NAMES.includes(cookieName(firstPair));
}

export async function handleGithubProxy(
  request: Request,
  config: LoadedConfig,
): Promise<Response> {
  const githubAuthUrl = config.githubAuthUrl;

  if (!githubAuthUrl) {
    return new Response('Not Found', { status: 404 });
  }

  const url = new URL(request.url);
  const mappedPath = PATH_MAP[url.pathname];

  if (!mappedPath) {
    return new Response('Not Found', { status: 404 });
  }

  const target = new URL(githubAuthUrl);

  // GITHUB_AUTH_URL tolerant behandeln: Basis-URL, mit/ohne Slash oder /auth.
  target.pathname = target.pathname.replace(/\/(auth)?\/?$/, '') + mappedPath;
  target.search = url.search;

  const upstreamHeaders = new Headers();

  for (const name of ['accept', 'accept-language', 'user-agent']) {
    const value = request.headers.get(name);

    if (value !== null) {
      upstreamHeaders.set(name, value);
    }
  }

  // Cookie NICHT roh durchreichen: nur den erlaubten CSRF-Cookie, damit
  // `CF_Authorization` & Co. den Upstream nie erreichen.
  const rawCookie = request.headers.get('cookie');

  if (rawCookie !== null) {
    const filtered = filterRequestCookies(rawCookie);

    if (filtered !== '') {
      upstreamHeaders.set('cookie', filtered);
    }
  }

  let upstream: Response;

  try {
    upstream = await fetch(target, {
      method: 'GET',
      headers: upstreamHeaders,
      redirect: 'manual',
    });
  } catch {
    return new Response(
      'Der GitHub-Login-Dienst ist derzeit nicht erreichbar. Bitte spaeter erneut versuchen.',
      {
        status: 502,
        headers: { 'content-type': 'text/plain; charset=utf-8', ...PROXY_SECURITY_HEADERS },
      },
    );
  }

  const responseHeaders = new Headers();

  // `cache-control` bewusst NICHT in dieser Liste (R4): der Wert wird unten
  // erzwungen, ein Upstream-Wert (auch ein oeffentlicher) darf ihn nie
  // aufweichen. `/callback` traegt einen persoenlichen GitHub-Token.
  for (const name of ['content-type', 'location']) {
    const value = upstream.headers.get(name);

    if (value !== null) {
      responseHeaders.set(name, value);
    }
  }

  // Nur erlaubte Set-Cookies an den Browser weitergeben: ein Upstream darf im
  // geteilten Admin-Origin kein Access-/Fremd-Cookie setzen.
  for (const cookie of upstream.headers.getSetCookie()) {
    if (isProxiedSetCookie(cookie)) {
      responseHeaders.append('set-cookie', cookie);
    }
  }

  // Sicherheitsheader auf JEDER Proxy-Antwort erzwingen (auch Redirects) —
  // geteilt mit den eigenen Seiten (`pages.ts`), aber bewusst OHNE CSP: die
  // Upstream-Callback-Seite nutzt Inline-Script fuer den postMessage-Handover
  // (`authorization:github:success`); eine CSP bräuchte `unsafe-inline` und
  // waere wertlos.
  for (const [name, value] of Object.entries(PROXY_SECURITY_HEADERS)) {
    responseHeaders.set(name, value);
  }

  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
