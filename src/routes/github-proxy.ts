import type { LoadedConfig } from '../config.js';

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

  for (const name of ['cookie', 'accept', 'accept-language', 'user-agent']) {
    const value = request.headers.get(name);

    if (value !== null) {
      upstreamHeaders.set(name, value);
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
      { status: 502, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
  }

  const responseHeaders = new Headers();

  for (const name of ['content-type', 'location', 'cache-control']) {
    const value = upstream.headers.get(name);

    if (value !== null) {
      responseHeaders.set(name, value);
    }
  }

  for (const cookie of upstream.headers.getSetCookie()) {
    responseHeaders.append('set-cookie', cookie);
  }

  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
