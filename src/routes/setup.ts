import { extractAud, validateAccessJwt } from '../access-jwt.js';
import {
  buildLoadedConfig,
  isValidHttpsUrl,
  parseAndValidateDomains,
  resolveAnchors,
} from '../config.js';
import { pollDeviceFlow, startDeviceFlow } from '../github.js';
import {
  renderDashboardPage,
  renderMissingConfigPage,
  renderSetupPage,
  renderWizardPage,
} from '../pages.js';
import type { StoredSettings } from '../token-store.js';
import { pickTexts } from '../texts.js';
import type { Env } from '../types.js';

function firstNonBlank(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (value !== undefined && value.trim() !== '') {
      return value;
    }
  }

  return undefined;
}

/**
 * Zustandsaendernde Setup-Routen, die einen JSON-Body erwarten: sie verlangen
 * `Content-Type: application/json` und lehnen sonst mit 415 ab — schliesst
 * CSRF-"simple requests" (z. B. `text/plain`) aus.
 */
const JSON_POST_PATHS = new Set([
  '/setup/settings',
  '/setup/github/poll',
  '/setup/users/delete',
]);

/**
 * Wizard-Schritt aus dem Settings-/Verbindungszustand ableiten (ADR 0014):
 * Schritte 1-3 sind Pflicht, 4-5 optional ("Überspringen" -> `*Skipped`),
 * 6 ist die Abschluss-Uebersicht.
 */
function currentWizardStep(
  accessAppAud: string | undefined,
  githubAppClientId: string | undefined,
  connected: boolean,
  allowedDomains: string[],
  githubAuthUrl: string | undefined,
  githubAuthUrlSkipped: boolean,
  manageEditorsUrl: string | undefined,
  manageEditorsUrlSkipped: boolean,
): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  if (accessAppAud === undefined) {
    return 1;
  }

  if (githubAppClientId === undefined) {
    return 2;
  }

  if (!connected) {
    return 3;
  }

  if (allowedDomains.length === 0) {
    return 4;
  }

  if (githubAuthUrl === undefined && !githubAuthUrlSkipped) {
    return 5;
  }

  if (manageEditorsUrl === undefined && !manageEditorsUrlSkipped) {
    return 6;
  }

  return 7;
}

interface SettingsUpdateBody {
  accessAppAud?: string;
  githubAppClientId?: string;
  allowedDomains?: string;
  githubAuthUrl?: string;
  manageEditorsUrl?: string;
  skipGithubAuthUrl?: boolean;
  skipManageEditorsUrl?: boolean;
  finishWizard?: boolean;
}

/**
 * `POST /setup/settings` (ADR 0014): Partial-Update mit serverseitiger
 * Validierung — das TokenStore-DO speichert nur. AUD-Pinning akzeptiert
 * ausschliesslich den Wert aus dem aktuell TOFU-validierten JWT, nie eine
 * freie Eingabe.
 */
async function handleUpdateSettings(
  request: Request,
  tokenStore: ReturnType<Env['TOKEN_STORE']['get']>,
  presentedAud: string | undefined,
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as SettingsUpdateBody | null;

  if (!body || typeof body !== 'object') {
    return Response.json({ ok: false, reason: 'invalid_body' }, { status: 400 });
  }

  const partial: StoredSettings = {};

  if (body.accessAppAud !== undefined) {
    if (presentedAud === undefined || body.accessAppAud !== presentedAud) {
      return Response.json({ ok: false, reason: 'invalid_aud' }, { status: 400 });
    }

    partial.accessAppAud = body.accessAppAud;
  }

  if (body.githubAppClientId !== undefined) {
    const clientId = body.githubAppClientId.trim();

    if (clientId === '') {
      return Response.json({ ok: false, reason: 'invalid_client_id' }, { status: 400 });
    }

    partial.githubAppClientId = clientId;
  }

  if (body.allowedDomains !== undefined) {
    const parsed = parseAndValidateDomains(body.allowedDomains);

    if (!parsed.ok) {
      return Response.json(
        parsed.reason === 'invalid_domain'
          ? { ok: false, reason: parsed.reason, domain: parsed.domain }
          : { ok: false, reason: parsed.reason },
        { status: 400 },
      );
    }

    partial.allowedDomains = parsed.domains;
  }

  if (body.githubAuthUrl !== undefined) {
    if (body.githubAuthUrl === '') {
      partial.githubAuthUrl = undefined;
      partial.githubAuthUrlDisabled = true; // explizit aus -> Env-Fallback unterdruecken
    } else if (!isValidHttpsUrl(body.githubAuthUrl)) {
      return Response.json({ ok: false, reason: 'invalid_url' }, { status: 400 });
    } else {
      partial.githubAuthUrl = body.githubAuthUrl;
      partial.githubAuthUrlDisabled = false;
    }
  }

  if (body.manageEditorsUrl !== undefined) {
    if (body.manageEditorsUrl === '') {
      partial.manageEditorsUrl = undefined;
      partial.manageEditorsUrlDisabled = true;
    } else if (!isValidHttpsUrl(body.manageEditorsUrl)) {
      return Response.json({ ok: false, reason: 'invalid_url' }, { status: 400 });
    } else {
      partial.manageEditorsUrl = body.manageEditorsUrl;
      partial.manageEditorsUrlDisabled = false;
    }
  }

  if (body.skipGithubAuthUrl === true) {
    partial.githubAuthUrlSkipped = true;
  }

  if (body.skipManageEditorsUrl === true) {
    partial.manageEditorsUrlSkipped = true;
  }

  if (body.finishWizard === true) {
    partial.wizardDone = true;
  }

  const updated = await tokenStore.updateSettings(partial);

  return Response.json({ ok: true, settings: updated });
}

/**
 * Verwaltung (ADR 0014, ADR 0011, ADR 0012): `/setup` zeigt den Wizard,
 * solange die Pflichtschritte (AUD, GitHub-Verbindung, erlaubte Domains)
 * unvollstaendig sind — sonst das Dashboard. Zusaetzlich unveraendert:
 * `/setup/github/{start,poll,rotate}` fuer die Bot-Autorisierung.
 *
 * TOFU-AUD (verbindlich, ADR 0014): Solange kein AUD gepinnt/aus Env
 * vorhanden ist, validiert der Worker das Access-JWT OHNE audience (nur
 * Signatur + `iss` + `exp`) und zeigt das im JWT praesentierte `aud` an.
 * Sobald ein AUD gepinnt ist, erzwingen ALLE Routen (auch Setup) exakt
 * dieses AUD.
 */
export async function handleSetup(request: Request, env: Env): Promise<Response> {
  const t = pickTexts(request.headers.get('accept-language'));
  const anchors = resolveAnchors(env);

  if (!anchors.ok) {
    return renderMissingConfigPage(anchors, t);
  }

  const tofu = await validateAccessJwt(request, anchors.accessTeamDomain, undefined);

  if (!tofu.ok) {
    return new Response(t.setup.accessDenied, { status: 401 });
  }

  if (anchors.setupAdmins.length === 0) {
    return new Response(t.setup.locked, { status: 403 });
  }

  const email = String(tofu.payload['email'] ?? '')
    .trim()
    .toLowerCase();

  if (email === '' || !anchors.setupAdmins.includes(email)) {
    return new Response(t.setup.adminsOnly, { status: 403 });
  }

  const tokenStore = env.TOKEN_STORE.get(env.TOKEN_STORE.idFromName('bot'));
  const settings = await tokenStore.getSettings();
  const pinnedAud = firstNonBlank(settings.accessAppAud, env.ACCESS_APP_AUD);
  const presentedAud = extractAud(tofu.payload.aud);

  // AUD-Pinning erzwingen, sobald bekannt (auch fuer Setup-Routen selbst).
  if (pinnedAud !== undefined && presentedAud !== pinnedAud) {
    return new Response(t.setup.accessDenied, { status: 401 });
  }

  const url = new URL(request.url);

  // CSRF-Schutz: Der Access-JWT wird von Cloudflare aus dem CF_Authorization-
  // Cookie injiziert; je nach dessen SameSite geht es bei Cross-Site-POSTs mit.
  // Zustandsaendernde Requests werden daher zusaetzlich an die eigene Origin
  // gebunden. Ein Browser sendet bei Cross-Site-POST/-fetch IMMER einen
  // Origin-Header; ein fehlender Origin stammt von Nicht-Browser-Clients
  // (kein CSRF-Vektor) und bleibt erlaubt.
  if (request.method === 'POST') {
    const origin = request.headers.get('origin');

    if (origin !== null && origin !== url.origin) {
      return new Response('Forbidden', { status: 403 });
    }

    if (JSON_POST_PATHS.has(url.pathname)) {
      const contentType = (request.headers.get('content-type') ?? '').toLowerCase();

      if (!contentType.includes('application/json')) {
        return new Response('Unsupported Media Type', { status: 415 });
      }
    }
  }

  const config = buildLoadedConfig(anchors, settings, env);

  if (url.pathname === '/setup' && request.method === 'GET') {
    const status = await tokenStore.status();
    // Der Wizard gilt erst als durchlaufen, wenn currentWizardStep die
    // Fertig-Seite (7) erreicht — so werden auch die optionalen Schritte 5/6
    // gezeigt, statt nach dem Domains-Schritt direkt ins Dashboard zu springen.
    // Der Wizard laeuft, bis der Nutzer ihn auf der Fertig-Seite abschliesst
    // (wizardDone-Flag) — so werden auch die optionalen Schritte gezeigt statt
    // nach dem Domains-Schritt direkt ins Dashboard zu springen. Bestehende
    // Deployments, deren Pflichtwerte aus Env kommen (Migration), gelten als
    // fertig eingerichtet und sehen sofort das Dashboard.
    const migrated =
      (env.ACCESS_APP_AUD ?? '').trim() !== '' && (env.GITHUB_APP_CLIENT_ID ?? '').trim() !== '';
    const wizardComplete =
      config.setupComplete && status.authorized && (settings.wizardDone === true || migrated);

    if (!wizardComplete) {
      const step = currentWizardStep(
        config.accessAppAud,
        config.githubAppClientId,
        status.authorized,
        config.allowedDomains,
        config.githubAuthUrl,
        config.githubAuthUrlSkipped,
        config.manageEditorsUrl,
        config.manageEditorsUrlSkipped,
      );

      return renderWizardPage(step, config, email, presentedAud, url.origin, t);
    }

    const users = await tokenStore.listUsers();
    return renderDashboardPage(config, status, users, email, presentedAud, t);
  }

  if (url.pathname === '/setup/settings' && request.method === 'POST') {
    return handleUpdateSettings(request, tokenStore, presentedAud);
  }

  if (url.pathname === '/setup/github' && request.method === 'GET') {
    const status = await tokenStore.status();

    return renderSetupPage(status.authorized, status.expiresAt, config.manageEditorsUrl, t);
  }

  const clientId = config.githubAppClientId;

  if (url.pathname === '/setup/github/start' && request.method === 'POST') {
    if (clientId === undefined) {
      return Response.json({ ok: false, reason: 'missing_client_id' }, { status: 400 });
    }

    const started = await startDeviceFlow(clientId);

    return Response.json(started, { status: started.ok ? 200 : 502 });
  }

  if (url.pathname === '/setup/github/disconnect' && request.method === 'POST') {
    await tokenStore.clearAuthorization();

    return Response.json({ ok: true });
  }

  if (url.pathname === '/setup/users/clear' && request.method === 'POST') {
    await tokenStore.clearUsers();

    return Response.json({ ok: true });
  }

  if (url.pathname === '/setup/users/delete' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as { email?: string };

    if (typeof body.email !== 'string' || body.email.trim() === '') {
      return Response.json({ ok: false, reason: 'missing_email' }, { status: 400 });
    }

    await tokenStore.deleteUser(body.email);

    return Response.json({ ok: true });
  }

  if (url.pathname === '/setup/github/rotate' && request.method === 'POST') {
    if (clientId === undefined) {
      return Response.json({ ok: false, reason: 'missing_client_id' }, { status: 400 });
    }

    // Sofort-Rotation (Ops/Leak-Verdacht/T-3-Test): entwertet das ausgegebene
    // Token unmittelbar — gleiche Wirkung wie ein Cron-Tick.
    const rotated = await tokenStore.rotate(clientId);

    // Traegt das frische Access-Token -> nicht cachebar.
    return Response.json(rotated, {
      status: rotated.ok ? 200 : 502,
      headers: { 'cache-control': 'no-store' },
    });
  }

  if (url.pathname === '/setup/github/poll' && request.method === 'POST') {
    if (clientId === undefined) {
      return Response.json({ ok: false, reason: 'missing_client_id' }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as { deviceCode?: string };

    if (!body.deviceCode) {
      return Response.json({ ok: false, reason: 'missing_device_code' }, { status: 400 });
    }

    const polled = await pollDeviceFlow(clientId, body.deviceCode);

    if (polled.ok) {
      await tokenStore.storeAuthorization(polled.pair);

      return Response.json({ ok: true });
    }

    return Response.json(polled, {
      status: polled.reason === 'pending' || polled.reason === 'slow_down' ? 200 : 502,
    });
  }

  return new Response('Not found', { status: 404 });
}
