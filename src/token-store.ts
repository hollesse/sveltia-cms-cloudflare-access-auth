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
  | { ok: false; reason: 'not_authorized' | 'refresh_failed' | 'login_disabled' };

/** Verifiziertes GitHub-Konto der aktuellen Autorisierung. */
export interface AccountInfo {
  login: string;
  installations: number;
}

export interface TokenStoreStatus {
  authorized: boolean;
  expiresAt: number | null;
  /** Aktuell gespeichertes Access-Token (nur Anzeige; loest KEINEN Refresh aus). */
  accessToken: string | null;
  /** Verifiziertes GitHub-Konto (Login + erreichbare Installationen) oder null. */
  account: AccountInfo | null;
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
  /**
   * Redakteur-Login deaktiviert: solange gesetzt, gibt `/auth/access` KEIN
   * Bot-Token mehr aus — auch bei gueltigem Access-JWT und noch laufender
   * Session. Nutzbar als geplanter Wartungsschalter oder als Sofort-Notbremse.
   * Der interne Cron-Refresh laeuft unberuehrt weiter; deaktiviert ist nur die
   * Herausgabe an Browser.
   */
  loginDisabled?: boolean;
}

const SETTINGS_KEY = 'settings:v1';
const USERS_KEY = 'users:v1';
const ACCOUNT_KEY = 'account:v1';
const PENDING_FLOW_KEY = 'pending-flow:v1';

/**
 * Serverseitiger Zustand eines laufenden Device Flows. Bindet die
 * Transaktion an die Admin-Session, die sie gestartet hat — `poll` schliesst
 * nur den eigenen, noch gueltigen Flow ab.
 */
export interface PendingDeviceFlow {
  /** Opaque, an den Browser gegebene Transaktions-ID (kein Geheimnis). */
  txId: string;
  /** Der eigentliche GitHub-`device_code` — verlaesst den Worker nicht. */
  deviceCode: string;
  /** Client-ID, mit der der Flow gestartet wurde. */
  clientId: string;
  /** E-Mail des Setup-Admins, der den Flow gestartet hat. */
  admin: string;
  /** Ablaufzeitpunkt (ms seit Epoch); danach ist die Transaktion ungueltig. */
  expiresAt: number;
}

/** Login-Historie eines Redakteurs (Betriebs-/Audit-Log, ADR 0015). */
export interface UserRecord {
  email: string;
  firstSeen: number;
  lastSeen: number;
}

const EVENTS_KEY = 'events:v1';
/** Cap: nur die neuesten N Sicherheitsereignisse werden vorgehalten. */
const MAX_EVENTS = 200;

/**
 * Unveraenderliches Sicherheitsereignis: wer (`actor`) wann (`at`)
 * was (`type`) getan hat, mit optionalem `detail`. Bewusst OHNE Tokenwerte /
 * Secrets. Append-only, gedeckelt, nicht per UI loeschbar — anders als die
 * Login-Historie.
 */
export interface AuditEvent {
  type: string;
  actor: string;
  at: number;
  detail?: string;
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

  /** Einmal-Setup: speichert das Paar aus dem Device Flow (neue Autorisierung). */
  async storeAuthorization(pair: TokenPair): Promise<void> {
    await this.ctx.storage.put({
      accessToken: pair.accessToken,
      expiresAt: pair.expiresAt,
      refreshToken: pair.refreshToken,
    });
    await this.bumpGeneration();
  }

  /** Speichert das verifizierte GitHub-Konto der aktuellen Autorisierung. */
  async storeAccount(account: AccountInfo): Promise<void> {
    await this.ctx.storage.put(ACCOUNT_KEY, account);
  }

  /**
   * Merkt sich einen gestarteten Device Flow serverseitig: der
   * rohe `device_code` bleibt im Worker; der Browser erhaelt nur die opaque
   * `txId`. Nur EIN Flow gleichzeitig — ein neuer Start ersetzt den vorigen.
   * Gebunden an Admin-Identitaet, Client-ID und Ablauf, damit `poll` fremde
   * oder untergeschobene Codes nicht abschliessen kann.
   */
  async storePendingFlow(flow: PendingDeviceFlow): Promise<void> {
    await this.ctx.storage.put(PENDING_FLOW_KEY, flow);
  }

  /** Liest den gestarteten Device Flow (oder null, wenn keiner laeuft). */
  async getPendingFlow(): Promise<PendingDeviceFlow | null> {
    return (await this.ctx.storage.get<PendingDeviceFlow>(PENDING_FLOW_KEY)) ?? null;
  }

  /**
   * Verwirft den gemerkten Device Flow (nach Abschluss oder hartem Fehler) —
   * aber NUR, wenn der gespeicherte Flow noch genau diese `txId` traegt. Eine
   * veraltete Antwort (z. B. nach Ablauf- oder Fehler-Cleanup einer laengst
   * ersetzten Transaktion) darf einen inzwischen neu gestarteten Flow nicht
   * mit entfernen.
   */
  async clearPendingFlow(txId: string): Promise<void> {
    const pending = await this.ctx.storage.get<PendingDeviceFlow>(PENDING_FLOW_KEY);

    if (pending && pending.txId === txId) {
      await this.ctx.storage.delete(PENDING_FLOW_KEY);
    }
  }

  /**
   * Atomarer Abschluss eines Device Flows (Reaudit R3, auth-g5h9j): der
   * Aufrufer hat die externen GitHub-Abfragen (Poll + Kontoverifikation)
   * bereits erledigt und liefert das fertige Ergebnis — diese Methode prueft
   * den DANN aktuellen Pending-Flow ERNEUT gegen txId/Admin/Client-ID/Ablauf,
   * bevor sie schreibt. Zwischen dieser Pruefung und dem Schreiben liegt KEIN
   * fetch mehr, also haelt das DO-Input-Gate beides atomar zusammen: ein
   * zwischenzeitlicher Disconnect oder ein neu gestarteter Flow (beide
   * aendern den gespeicherten Pending-Flow) lassen die Pruefung fehlschlagen,
   * OHNE dass etwas gespeichert oder der (dann fremde) Pending-Flow geloescht
   * wird.
   */
  async completePendingFlow(
    txId: string,
    clientId: string,
    admin: string,
    now: number,
    pair: TokenPair,
    account: AccountInfo,
  ): Promise<{ ok: boolean }> {
    const pending = await this.ctx.storage.get<PendingDeviceFlow>(PENDING_FLOW_KEY);

    if (
      !pending ||
      pending.txId !== txId ||
      pending.admin !== admin ||
      pending.clientId !== clientId ||
      pending.expiresAt <= now
    ) {
      return { ok: false };
    }

    await this.ctx.storage.put({
      accessToken: pair.accessToken,
      expiresAt: pair.expiresAt,
      refreshToken: pair.refreshToken,
      [ACCOUNT_KEY]: account,
    });
    await this.ctx.storage.delete(PENDING_FLOW_KEY);
    await this.bumpGeneration();

    return { ok: true };
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
   * Haengt ein Sicherheitsereignis an (append-only, Cap MAX_EVENTS): nur
   * `type`/`actor`/`detail`/`at` — nie Tokenwerte. Kein Loesch-Pendant.
   */
  async recordEvent(event: { type: string; actor: string; detail?: string }, now: number): Promise<void> {
    const events = (await this.ctx.storage.get<AuditEvent[]>(EVENTS_KEY)) ?? [];
    events.push({
      type: event.type,
      actor: event.actor,
      at: now,
      ...(event.detail !== undefined ? { detail: event.detail } : {}),
    });
    const capped = events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;
    await this.ctx.storage.put(EVENTS_KEY, capped);
  }

  /** Sicherheitsereignisse, neueste zuerst. */
  async listEvents(): Promise<AuditEvent[]> {
    const events = (await this.ctx.storage.get<AuditEvent[]>(EVENTS_KEY)) ?? [];
    return [...events].reverse();
  }

  /**
   * Trennt die Verbindung: loescht das Token-Paar (fuer Wizard-Neudurchlauf
   * bzw. Betreiber-Wunsch). Widerruft NICHT bei GitHub — das geschieht in den
   * GitHub-Einstellungen des Bot-Accounts (Applications -> Authorized). Ein
   * noch laufender Pending-Flow wird mit entwertet (Reaudit R3, auth-g5h9j):
   * sonst koennte eine alte, noch nicht abgeschlossene Transaktion nach dem
   * Disconnect weiter abgeschlossen werden.
   */
  async clearAuthorization(): Promise<void> {
    await this.ctx.storage.delete([
      'accessToken',
      'expiresAt',
      'refreshToken',
      ACCOUNT_KEY,
      PENDING_FLOW_KEY,
    ]);
    await this.bumpGeneration();
  }

  /** Fuer die Setup-Seite: ist der Tresor befuellt, bis wann gilt das Token? */
  async status(): Promise<TokenStoreStatus> {
    const [refreshToken, expiresAt, accessToken, account] = await Promise.all([
      this.ctx.storage.get<string>('refreshToken'),
      this.ctx.storage.get<number>('expiresAt'),
      this.ctx.storage.get<string>('accessToken'),
      this.ctx.storage.get<AccountInfo>(ACCOUNT_KEY),
    ]);

    return {
      authorized: refreshToken !== undefined,
      expiresAt: expiresAt ?? null,
      accessToken: accessToken ?? null,
      account: account ?? null,
    };
  }

  /**
   * Login-Pfad: liefert das gecachte Access-Token; refresht nur im Notfall
   * (abgelaufen/knapp — z. B. nach verpassten Cron-Ticks).
   *
   * Ausgabeentscheidung (Reaudit R2, auth-f2t6w): `loginDisabled` liegt als
   * Setting im SELBEN DO (`settings:v1`) und wird HIER, NACH allen Awaits
   * (Cache-Read wie Notfall-Refresh) und unmittelbar vor der Rueckgabe,
   * erneut geprueft — nicht nur einmal bei Request-Beginn in der Route. So
   * gibt ein Login, der waehrend eines dieser Awaits gesperrt wird, trotz
   * vorhandenem bzw. frisch geholtem Token kein Ergebnis mehr heraus. Der
   * Refresh selbst laeuft unberuehrt durch und SPEICHERT das neue Paar
   * (Rotation/Selbstheilung bleibt intakt, siehe `doRefresh`) — nur die
   * Herausgabe an diesen Aufrufer wird verweigert. Die Pruefung liegt
   * bewusst AUSSERHALB der koaleszierten `refreshInFlight`-Promise (die
   * teilt sich der Cron-Pfad ueber `rotate`, der ungegated bleibt).
   */
  async getAccessToken(clientId: string): Promise<GetTokenResult> {
    const [accessToken, expiresAt] = await Promise.all([
      this.ctx.storage.get<string>('accessToken'),
      this.ctx.storage.get<number>('expiresAt'),
    ]);

    const result: GetTokenResult =
      accessToken !== undefined &&
      expiresAt !== undefined &&
      expiresAt - Date.now() > MIN_REMAINING_MS
        ? { ok: true, token: accessToken }
        : await this.refresh(clientId);

    if (result.ok) {
      const settings = await this.getSettings();

      if (settings.loginDisabled) {
        return { ok: false, reason: 'login_disabled' };
      }
    }

    return result;
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
   * ist bewusst dumm (ADR 0014); ob invalidiert wird (z. B. Client-ID-
   * Wechsel), entscheidet daher der Aufrufer, nicht diese Methode.
   *
   * `invalidateAuthorization` (Reaudit R3, auth-g5h9j): loescht Token-Paar,
   * Konto UND einen laufenden Pending-Flow atomar mit dem Settings-Write und
   * bumpt die Generation — sonst wuerde ein Client-ID-Wechsel ein Bot-Token
   * der vorherigen App weiter ausgeben bzw. einen noch laufenden Flow der
   * alten Client-ID unbemerkt abschliessbar lassen.
   */
  async updateSettings(
    partial: StoredSettings,
    options?: { invalidateAuthorization?: boolean },
  ): Promise<StoredSettings> {
    const current = await this.getSettings();
    const next: StoredSettings = { ...current, ...partial };

    await this.ctx.storage.put(SETTINGS_KEY, next);

    if (options?.invalidateAuthorization) {
      await this.ctx.storage.delete([
        'accessToken',
        'expiresAt',
        'refreshToken',
        ACCOUNT_KEY,
        PENDING_FLOW_KEY,
      ]);
      await this.bumpGeneration();
    }

    return next;
  }

  /**
   * Erhoeht die Autorisierungs-Generation (bei neuer Autorisierung bzw.
   * Disconnect). Ein zeitgleich laufender Refresh erkennt an einer veraenderten
   * Generation, dass sein Ergebnis veraltet ist, und verwirft es.
   */
  private async bumpGeneration(): Promise<void> {
    const generation = (await this.ctx.storage.get<number>('generation')) ?? 0;
    await this.ctx.storage.put('generation', generation + 1);
  }

  private refresh(clientId: string): Promise<GetTokenResult> {
    this.refreshInFlight ??= this.doRefresh(clientId).finally(() => {
      this.refreshInFlight = undefined;
    });

    return this.refreshInFlight;
  }

  private async doRefresh(clientId: string): Promise<GetTokenResult> {
    const [refreshToken, generation] = await Promise.all([
      this.ctx.storage.get<string>('refreshToken'),
      this.ctx.storage.get<number>('generation'),
    ]);

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

    // Waehrend des GitHub-Fetch (Input-Gate offen) koennte ein Disconnect oder
    // eine neue Autorisierung gelaufen sein — dann ist dieses Ergebnis veraltet
    // und darf NICHT gespeichert werden (sonst wird der getrennte Zustand
    // wiederhergestellt bzw. ein neues Konto ueberschrieben). Neu-Pruefung und
    // Write laufen ohne fetch dazwischen, also atomar (DO-Input-Gate).
    const currentGeneration = (await this.ctx.storage.get<number>('generation')) ?? 0;

    if ((generation ?? 0) !== currentGeneration) {
      return { ok: false, reason: 'refresh_failed' };
    }

    await this.ctx.storage.put({
      accessToken: result.pair.accessToken,
      expiresAt: result.pair.expiresAt,
      refreshToken: result.pair.refreshToken,
    });

    return { ok: true, token: result.pair.accessToken };
  }
}
