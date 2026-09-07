import { extractAud, validateAccessJwt } from '../access-jwt.js';
import {
  buildLoadedConfig,
  isValidHttpsUrl,
  parseAndValidateDomains,
  resolveAnchors,
} from '../config.js';
import { pollDeviceFlow, startDeviceFlow, verifyAuthorization } from '../github.js';
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
  '/setup/login',
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
  email: string,
  currentClientId: string | undefined,
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

  // Client-ID-Wechsel entwertet die gespeicherte Autorisierung + einen
  // laufenden Pending-Flow (Reaudit R3, auth-g5h9j): Vergleich gegen die
  // EFFEKTIVE aktuelle Client-ID (inkl. Env-Fallback), nicht nur gegen den
  // gespeicherten Settings-Wert — sonst wuerde ein migriertes Deployment
  // (Client-ID nur aus Env) den Wechsel nicht erkennen. Der ERSTMALIGE Bezug
  // einer Client-ID (vorher unbekannt, Wizard-Schritt 2) ist kein Wechsel —
  // es gibt noch nichts Fremdes zu entwerten.
  const clientIdChanged =
    currentClientId !== undefined &&
    partial.githubAppClientId !== undefined &&
    partial.githubAppClientId !== currentClientId;

  const updated = await tokenStore.updateSettings(partial, {
    invalidateAuthorization: clientIdChanged,
  });

  if (clientIdChanged) {
    await tokenStore.recordEvent(
      {
        type: 'github_client_id_changed',
        actor: email,
        // clientIdChanged garantiert currentClientId !== undefined (s. o.).
        detail: `${currentClientId} -> ${partial.githubAppClientId}`,
      },
      Date.now(),
    );
  }

  await tokenStore.recordEvent(
    { type: 'settings_updated', actor: email, detail: Object.keys(body).join(', ') },
    Date.now(),
  );

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

  // Ist der optionale Bootstrap-AUD gesetzt, wird er ab dem ersten Request
  // erzwungen (kein TOFU-Fenster): ein JWT einer anderen App derselben
  // Team-Domain wird abgewiesen. Nicht gesetzt -> TOFU (audience undefined).
  const tofu = await validateAccessJwt(request, anchors.accessTeamDomain, anchors.bootstrapAud);

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
    const events = await tokenStore.listEvents();
    return renderDashboardPage(config, status, users, events, email, presentedAud, t);
  }

  if (url.pathname === '/setup/settings' && request.method === 'POST') {
    return handleUpdateSettings(request, tokenStore, presentedAud, email, config.githubAppClientId);
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

    if (!started.ok) {
      return Response.json(started, { status: 502 });
    }

    // Den rohen device_code serverseitig halten; der Browser
    // erhaelt nur eine opaque txId, gebunden an diese Admin-Session + Client-ID.
    const txId = crypto.randomUUID();
    await tokenStore.storePendingFlow({
      txId,
      deviceCode: started.deviceCode,
      clientId,
      admin: email,
      expiresAt: Date.now() + started.expiresIn * 1000,
    });

    return Response.json({
      ok: true,
      txId,
      userCode: started.userCode,
      verificationUri: started.verificationUri,
      interval: started.interval,
    });
  }

  if (url.pathname === '/setup/login' && request.method === 'POST') {
    const body = (await request.json().catch(() => null)) as { disabled?: boolean } | null;

    if (!body || typeof body.disabled !== 'boolean') {
      return Response.json({ ok: false, reason: 'invalid_body' }, { status: 400 });
    }

    await tokenStore.updateSettings({ loginDisabled: body.disabled });
    await tokenStore.recordEvent(
      { type: body.disabled ? 'login_disabled' : 'login_enabled', actor: email },
      Date.now(),
    );

    return Response.json({ ok: true, disabled: body.disabled });
  }

  if (url.pathname === '/setup/github/disconnect' && request.method === 'POST') {
    await tokenStore.clearAuthorization();
    await tokenStore.recordEvent({ type: 'bot_disconnected', actor: email }, Date.now());

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
    await tokenStore.recordEvent(
      { type: rotated.ok ? 'token_rotated' : 'token_rotate_failed', actor: email },
      Date.now(),
    );

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

    const body = (await request.json().catch(() => ({}))) as { txId?: string };

    if (!body.txId) {
      return Response.json({ ok: false, reason: 'missing_tx_id' }, { status: 400 });
    }

    const txId = body.txId;
    const pending = await tokenStore.getPendingFlow();

    // Vor-Check, spart einen GitHub-Roundtrip bei offensichtlich falscher
    // Transaktion (txId, Admin-Identitaet, Client-ID, Ablauf). Der
    // VERBINDLICHE Check gegen den DANN aktuellen Pending-Flow passiert erst
    // in completePendingFlow, NACH den externen Abfragen unten — dazwischen
    // kann ein Disconnect oder ein neu gestarteter Flow liegen (Reaudit R3,
    // auth-g5h9j).
    if (
      !pending ||
      pending.txId !== txId ||
      pending.admin !== email ||
      pending.clientId !== clientId ||
      pending.expiresAt <= Date.now()
    ) {
      if (pending && pending.expiresAt <= Date.now()) {
        await tokenStore.clearPendingFlow(pending.txId);
      }

      return Response.json({ ok: false, reason: 'unknown_transaction' }, { status: 400 });
    }

    const polled = await pollDeviceFlow(clientId, pending.deviceCode);

    if (polled.ok) {
      // Vor dem Speichern verifizieren, WELCHES Konto autorisiert hat:
      // ein ungueltiges Token wird nicht abgelegt (keine stille Fehlverbindung).
      const verified = await verifyAuthorization(polled.pair.accessToken);

      if (!verified.ok) {
        await tokenStore.clearPendingFlow(txId);

        return Response.json({ ok: false, reason: verified.reason }, { status: 502 });
      }

      // Atomarer Abschluss (Reaudit R3, auth-g5h9j): prueft den Pending-Flow
      // ERNEUT gegen den dann aktuellen Stand und schreibt nur, wenn er noch
      // passt — ein zwischenzeitlicher Disconnect oder ein neuer Flow lassen
      // diesen (dann veralteten) Abschluss abgewiesen werden, ohne etwas zu
      // speichern oder den fremden Pending-Flow zu loeschen.
      const completed = await tokenStore.completePendingFlow(
        txId,
        clientId,
        email,
        Date.now(),
        polled.pair,
        { login: verified.login, installations: verified.installations },
      );

      if (!completed.ok) {
        return Response.json({ ok: false, reason: 'unknown_transaction' }, { status: 400 });
      }

      await tokenStore.recordEvent({ type: 'bot_connected', actor: email, detail: verified.login }, Date.now());

      return Response.json({ ok: true });
    }

    // pending/slow_down: Transaktion laeuft weiter; harter Fehler: verwerfen.
    if (polled.reason !== 'pending' && polled.reason !== 'slow_down') {
      await tokenStore.clearPendingFlow(txId);
    }

    return Response.json(polled, {
      status: polled.reason === 'pending' || polled.reason === 'slow_down' ? 200 : 502,
    });
  }

  return new Response('Not found', { status: 404 });
}
