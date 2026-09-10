import type { StoredSettings } from './token-store.js';
import type { Env } from './types.js';

/**
 * Zwei Vertrauensanker (ADR 0014): `ACCESS_TEAM_DOMAIN` validiert Issuer/JWKS
 * (nie speicherbar) und `SETUP_ADMINS` ist die Bootstrap-Identitaet
 * (Rettungsweg `wrangler secret put`). Alles andere lebt als Setting im
 * TokenStore-Durable-Object mit Env-Fallback (Migrationspfad, s. `loadConfig`).
 */
const REQUIRED_ANCHOR_KEYS = ['ACCESS_TEAM_DOMAIN', 'SETUP_ADMINS'] as const;

export type ConfigEnv = Omit<Env, 'TOKEN_STORE'>;

export interface Anchors {
  accessTeamDomain: string;
  setupAdmins: string[];
  /** Optional: erzwingt `/setup` sofort auf dieses `aud` (kein TOFU), wenn gesetzt. */
  bootstrapAud?: string;
}

export interface MissingRequiredConfig {
  ok: false;
  reason: 'missing_required';
  missingKeys: string[];
}

export type AnchorsResult = ({ ok: true } & Anchors) | MissingRequiredConfig;

const isBlank = (value: string | undefined): boolean =>
  value === undefined || value.trim() === '';

function firstNonBlank(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (!isBlank(value)) {
      return value;
    }
  }

  return undefined;
}

function parseList(raw: string | undefined): string[] {
  if (isBlank(raw)) {
    return [];
  }

  return raw!
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/** Env-Fallback-Parsing von `ALLOWED_DOMAINS` (kommagetrennt); verwirft
 * Einträge, die keine reinen Hostnamen sind — gleiche Validierung wie im Wizard,
 * damit kein ungültiger Wert in die Origin-Allowlist gelangt. */
export function parseAllowedDomains(raw: string | undefined): string[] {
  return parseList(raw).filter((entry) => isValidHostname(entry));
}

/**
 * Reine Anker-Aufloesung (kein DO-Zugriff): fehlt einer, ist der Worker
 * grundsaetzlich nicht betriebsbereit — nicht einmal `/setup` funktioniert
 * (fail-closed, ADR 0009 + ADR 0012).
 */
export function resolveAnchors(env: ConfigEnv): AnchorsResult {
  const missingKeys: string[] = REQUIRED_ANCHOR_KEYS.filter((key) => isBlank(env[key]));

  if (missingKeys.length > 0) {
    return { ok: false, reason: 'missing_required', missingKeys };
  }

  return {
    ok: true,
    accessTeamDomain: env.ACCESS_TEAM_DOMAIN!,
    setupAdmins: parseList(env.SETUP_ADMINS),
    bootstrapAud: firstNonBlank(env.SETUP_BOOTSTRAP_AUD),
  };
}

/**
 * Prueft, ob `domain` (typischerweise der `site_id`-Parameter oder ein
 * `postMessage`-Origin-Hostname) gegen die konfigurierte Domain-Liste
 * matched. Exaktes Match oder Subdomain eines erlaubten Eintrags.
 */
export function isAllowedDomain(domain: string, allowedDomains: string[]): boolean {
  const normalized = domain.trim().toLowerCase();

  if (normalized === '') {
    return false;
  }

  return allowedDomains.some(
    (allowed) => normalized === allowed || normalized.endsWith(`.${allowed}`),
  );
}

/**
 * Baut die exakten erlaubten Token-Handover-Origins aus den konfigurierten
 * Domains: jede Domain -> genau `https://<domain>` (Standard-Port). Der
 * postMessage-Empfaenger-Check vergleicht `event.origin` exakt gegen diese
 * Liste — kein `http`, kein abweichender Port, keine automatischen Subdomains
 * (anders als `isAllowedDomain`, das nur das schwaechere `site_id`-Eingangs-Gate
 * bedient). Weitere (Sub-)Domains muessen ausdruecklich in `allowedDomains` stehen.
 */
export function buildAllowedOrigins(allowedDomains: string[]): string[] {
  return allowedDomains.map((domain) => `https://${domain}`);
}

/** Hostname ohne Schema/Pfad (Setup-Formular-Validierung, ADR 0014). */
const HOSTNAME_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;

export function isValidHostname(value: string): boolean {
  return value.length > 0 && !value.includes('://') && !value.includes('/') && HOSTNAME_RE.test(value);
}

export type DomainsValidationResult =
  | { ok: true; domains: string[] }
  | { ok: false; reason: 'invalid_domain'; domain: string }
  | { ok: false; reason: 'empty_domains' };

/** Validiert die kommagetrennte `allowedDomains`-Formulareingabe des Wizards/Dashboards. */
export function parseAndValidateDomains(raw: string): DomainsValidationResult {
  const parts = raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);

  for (const part of parts) {
    if (!isValidHostname(part)) {
      return { ok: false, reason: 'invalid_domain', domain: part };
    }
  }

  if (parts.length === 0) {
    return { ok: false, reason: 'empty_domains' };
  }

  return { ok: true, domains: parts };
}

/** `https://…`-Validierung fuer `githubAuthUrl`/`manageUsersUrl`. */
export function isValidHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export interface LoadedConfig {
  ok: true;
  accessTeamDomain: string;
  setupAdmins: string[];
  accessAppAud: string | undefined;
  githubAppClientId: string | undefined;
  allowedDomains: string[];
  githubAuthUrl: string | undefined;
  manageUsersUrl: string | undefined;
  githubAuthUrlSkipped: boolean;
  manageUsersUrlSkipped: boolean;
  /** Nutzer-Login deaktiviert: `/auth/access` gibt keine Bot-Tokens mehr aus. */
  loginDisabled: boolean;
  /** AUD + Client-ID gepinnt/bekannt UND mind. eine erlaubte Domain (Wizard-Schritte 1-3). */
  setupComplete: boolean;
}

export type LoadConfigResult = LoadedConfig | MissingRequiredConfig;

/** Reiner Merge (Anker + DO-Settings + Env-Fallback) — ohne DO-Zugriff, fuer Wiederverwendung. */
export function buildLoadedConfig(
  anchors: Anchors,
  settings: StoredSettings,
  env: ConfigEnv,
): LoadedConfig {
  const accessAppAud = firstNonBlank(settings.accessAppAud, env.ACCESS_APP_AUD);
  const githubAppClientId = firstNonBlank(settings.githubAppClientId, env.GITHUB_APP_CLIENT_ID);
  const allowedDomains =
    settings.allowedDomains && settings.allowedDomains.length > 0
      ? settings.allowedDomains
      : parseAllowedDomains(env.ALLOWED_DOMAINS);
  // Explizit deaktiviert schlaegt den Env-Fallback (sonst lebt ein geleerter
  // Wert im migrierten Deployment wieder auf).
  const githubAuthUrl = settings.githubAuthUrlDisabled
    ? undefined
    : firstNonBlank(settings.githubAuthUrl, env.GITHUB_AUTH_URL);
  const manageUsersUrl = settings.manageUsersUrlDisabled
    ? undefined
    : firstNonBlank(settings.manageUsersUrl, env.MANAGE_USERS_URL);

  return {
    ok: true,
    accessTeamDomain: anchors.accessTeamDomain,
    setupAdmins: anchors.setupAdmins,
    accessAppAud,
    githubAppClientId,
    allowedDomains,
    githubAuthUrl,
    manageUsersUrl,
    githubAuthUrlSkipped: settings.githubAuthUrlSkipped === true,
    manageUsersUrlSkipped: settings.manageUsersUrlSkipped === true,
    loginDisabled: settings.loginDisabled === true,
    setupComplete:
      accessAppAud !== undefined && githubAppClientId !== undefined && allowedDomains.length > 0,
  };
}

/**
 * Loest die vollstaendige Worker-Konfiguration auf: Anker aus `env`, Rest aus
 * dem TokenStore-DO mit Env-Fallback (ADR 0014). Lazy pro Request, NICHT
 * ueber Requests hinweg gecacht — ein Settings-Update wirkt sofort.
 */
export async function loadConfig(env: Env): Promise<LoadConfigResult> {
  const anchors = resolveAnchors(env);

  if (!anchors.ok) {
    return anchors;
  }

  const tokenStore = env.TOKEN_STORE.get(env.TOKEN_STORE.idFromName('bot'));
  const settings = await tokenStore.getSettings();

  return buildLoadedConfig(anchors, settings, env);
}
