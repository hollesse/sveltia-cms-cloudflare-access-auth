import { DurableObject } from 'cloudflare:workers';

import { refreshUserToken, type TokenPair } from './github.js';
import type { Env } from './types.js';

/**
 * Restlaufzeit, unter der ein Login das Token nicht mehr ausgeben soll,
 * sondern einen Notfall-Refresh anstoesst (Selbstheilung bei verpassten
 * Cron-Ticks). Regulaer rotiert der Cron (0/6/12/18 Uhr UTC) lange vorher.
 */
const MIN_REMAINING_MS = 15 * 60 * 1000;

export type GetTokenResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'not_authorized' | 'refresh_failed' };

export interface TokenStoreStatus {
  authorized: boolean;
  expiresAt: number | null;
  /** Aktuell gespeichertes Access-Token (nur Anzeige; loest KEINEN Refresh aus). */
  accessToken: string | null;
}

/**
 * Betreiber-Einstellungen (ADR 0014): der Env-Schnitt schrumpft auf zwei
 * Vertrauensanker (`ACCESS_TEAM_DOMAIN`, `SETUP_ADMINS`); alles andere lebt
 * hier, mit Env-Fallback in `loadConfig` (`config.ts`). `*Skipped` haelt
 * ausschliesslich den "Ubersprungen"-Klick der beiden optionalen
 * Wizard-Schritte fest (rein UI-Zustand, kein Env-Fallback-Pendant).
 */
export interface StoredSettings {
  accessAppAud?: string;
  githubAppClientId?: string;
  allowedDomains?: string[];
  githubAuthUrl?: string;
  manageEditorsUrl?: string;
  githubAuthUrlSkipped?: boolean;
  /** Vom Fertig-Schritt des Wizards gesetzt (ADR 0014): Wizard durchlaufen. */
  wizardDone?: boolean;
  manageEditorsUrlSkipped?: boolean;
  /**
   * Explizit deaktiviert: der Betreiber hat die URL im Dashboard geleert. Anders
   * als "nicht gesetzt" unterdrueckt dies den gleichnamigen Env-Fallback, sodass
   * ein migriertes Deployment die Funktion wirklich abschalten kann.
   */
  githubAuthUrlDisabled?: boolean;
  manageEditorsUrlDisabled?: boolean;
}

const SETTINGS_KEY = 'settings:v1';
const USERS_KEY = 'users:v1';

/** Login-Historie eines Redakteurs (Betriebs-/Audit-Log, ADR 0015). */
export interface UserRecord {
  email: string;
  firstSeen: number;
  lastSeen: number;
}

/**
 * Der Token-Tresor (ADR 0011): haelt genau EIN GitHub-App-User-Token-Paar
 * des Bot-Accounts. Ein Durable Object statt KV, weil (a) sein Binding rein
 * generisch in der wrangler.toml lebt (keine account-spezifische Namespace-ID
 * — Betreiber editieren nichts im Repo) und (b) es Refreshes von Natur aus
 * serialisiert: Das Refresh-Token ist single-use, paralleles Einloesen waere
 * ein Kettenriss. Zusaetzlich koaleszieren wir konkurrierende Refreshes ueber
 * eine In-Flight-Promise (DO-Input-Gates oeffnen bei fetch()-Awaits).
 */
export class TokenStore extends DurableObject<Env> {
  private refreshInFlight: Promise<GetTokenResult> | undefined;

  /** Einmal-Setup: speichert das Paar aus dem Device Flow. */
  async storeAuthorization(pair: TokenPair): Promise<void> {
    await this.ctx.storage.put({
      accessToken: pair.accessToken,
      expiresAt: pair.expiresAt,
      refreshToken: pair.refreshToken,
    });
  }

  /**
   * Vermerkt einen erfolgreichen Redakteurs-Login (E-Mail aus dem
   * validierten Access-JWT). Upsert: firstSeen bleibt, lastSeen wird
   * aktualisiert. Bewusste, dokumentierte Persistenz-Ausnahme (ADR 0015).
   */
  async recordLogin(email: string, now: number): Promise<void> {
    const users = (await this.ctx.storage.get<Record<string, UserRecord>>(USERS_KEY)) ?? {};
    const key = email.trim().toLowerCase();
    if (key === '') { return; }
    const existing = users[key];
    users[key] = {
      email: key,
      firstSeen: existing ? existing.firstSeen : now,
      lastSeen: now,
    };
    await this.ctx.storage.put(USERS_KEY, users);
  }

  /** Liste aller je angemeldeten Redakteure (neueste Aktivitaet zuerst). */
  async listUsers(): Promise<UserRecord[]> {
    const users = (await this.ctx.storage.get<Record<string, UserRecord>>(USERS_KEY)) ?? {};
    return Object.values(users).sort((a, b) => b.lastSeen - a.lastSeen);
  }

  /** Loescht die gesamte Login-Historie (Datenschutz, ADR 0015). */
  async clearUsers(): Promise<void> {
    await this.ctx.storage.delete(USERS_KEY);
  }

  /** Loescht den Verlauf eines einzelnen Benutzers (Datenschutz, ADR 0015). */
  async deleteUser(email: string): Promise<void> {
    const users = (await this.ctx.storage.get<Record<string, UserRecord>>(USERS_KEY)) ?? {};
    delete users[email.trim().toLowerCase()];
    await this.ctx.storage.put(USERS_KEY, users);
  }

  /**
   * Trennt die Verbindung: loescht das Token-Paar (fuer Wizard-Neudurchlauf
   * bzw. Betreiber-Wunsch). Widerruft NICHT bei GitHub — das geschieht in den
   * GitHub-Einstellungen des Bot-Accounts (Applications -> Authorized).
   */
  async clearAuthorization(): Promise<void> {
    await this.ctx.storage.delete(['accessToken', 'expiresAt', 'refreshToken']);
  }

  /** Fuer die Setup-Seite: ist der Tresor befuellt, bis wann gilt das Token? */
  async status(): Promise<TokenStoreStatus> {
    const [refreshToken, expiresAt, accessToken] = await Promise.all([
      this.ctx.storage.get<string>('refreshToken'),
      this.ctx.storage.get<number>('expiresAt'),
      this.ctx.storage.get<string>('accessToken'),
    ]);

    return {
      authorized: refreshToken !== undefined,
      expiresAt: expiresAt ?? null,
      accessToken: accessToken ?? null,
    };
  }

  /**
   * Login-Pfad: liefert das gecachte Access-Token; refresht nur im Notfall
   * (abgelaufen/knapp — z. B. nach verpassten Cron-Ticks).
   */
  async getAccessToken(clientId: string): Promise<GetTokenResult> {
    const [accessToken, expiresAt] = await Promise.all([
      this.ctx.storage.get<string>('accessToken'),
      this.ctx.storage.get<number>('expiresAt'),
    ]);

    if (
      accessToken !== undefined &&
      expiresAt !== undefined &&
      expiresAt - Date.now() > MIN_REMAINING_MS
    ) {
      return { ok: true, token: accessToken };
    }

    return this.refresh(clientId);
  }

  /** Cron-Pfad: rotiert unconditionally (0/6/12/18 Uhr UTC). */
  async rotate(clientId: string): Promise<GetTokenResult> {
    return this.refresh(clientId);
  }

  /** Liefert die aktuell gespeicherten Settings (leeres Objekt = nichts gesetzt). */
  async getSettings(): Promise<StoredSettings> {
    return (await this.ctx.storage.get<StoredSettings>(SETTINGS_KEY)) ?? {};
  }

  /**
   * Partial-Update der Settings: reines Merge + Speichern. Validierung
   * passiert im Worker (Route `POST /setup/settings`, `config.ts`) — das DO
   * ist bewusst dumm (ADR 0014).
   */
  async updateSettings(partial: StoredSettings): Promise<StoredSettings> {
    const current = await this.getSettings();
    const next: StoredSettings = { ...current, ...partial };

    await this.ctx.storage.put(SETTINGS_KEY, next);

    return next;
  }

  private refresh(clientId: string): Promise<GetTokenResult> {
    this.refreshInFlight ??= this.doRefresh(clientId).finally(() => {
      this.refreshInFlight = undefined;
    });

    return this.refreshInFlight;
  }

  private async doRefresh(clientId: string): Promise<GetTokenResult> {
    const refreshToken = await this.ctx.storage.get<string>('refreshToken');

    if (refreshToken === undefined) {
      return { ok: false, reason: 'not_authorized' };
    }

    const result = await refreshUserToken(clientId, refreshToken);

    if (!result.ok) {
      // Altes Paar NICHT loeschen: bei transienten GitHub-Fehlern bleibt das
      // (womoeglich noch gueltige) Access-Token nutzbar und der naechste
      // Cron-Tick versucht es erneut. Ein dauerhaft ungueltiges Refresh-Token
      // (Widerruf) faellt hier ebenfalls durch — Wiederanlauf via /setup.
      return { ok: false, reason: 'refresh_failed' };
    }

    await this.storeAuthorization(result.pair);

    return { ok: true, token: result.pair.accessToken };
  }
}
