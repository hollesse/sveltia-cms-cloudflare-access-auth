import type { TokenStore } from './token-store.js';

/**
 * Env-Schnitt laut ADR 0009 (+ Amendments) und ADR 0011: Der Worker braucht
 * KEINE GitHub-Secrets mehr — die Token-Quelle ist das TokenStore-Durable-
 * Object (GitHub-App-User-Tokens des Bot-Accounts, per Device Flow einmalig
 * autorisiert). Konfigurationswerte werden uniform aus `env` gelesen und im
 * Dashboard bzw. per `wrangler secret put` gesetzt; alle optional, weil
 * `resolveConfig` Fehlkonfiguration zur Laufzeit verstaendlich meldet.
 */
export interface Env {
  /** Client-ID der GitHub App (oeffentlicher Identifikator, kein Secret). */
  GITHUB_APP_CLIENT_ID?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_APP_AUD?: string;
  /**
   * Optionaler Bootstrap-Anker (Secret): ist er gesetzt, erzwingt `/setup` von
   * Anfang an genau dieses `aud` — kein TOFU-Fenster. Nicht gesetzt = heutiges
   * TOFU-Verhalten (jede Setup-Admin-Session der Team-Domain, bis ein AUD
   * gepinnt ist). Sinnvoll bei geteilter Team-Domain mit mehreren Access-Apps.
   */
  SETUP_BOOTSTRAP_AUD?: string;
  ALLOWED_DOMAINS?: string;
  GITHUB_AUTH_URL?: string;
  /**
   * Kommagetrennte E-Mail-Liste der Setup-Admins (ADR 0012): Nur diese
   * Access-authentifizierten Nutzer erreichen `/setup/github/*`. Leer/
   * fehlend = Setup-Routen gesperrt (fail-closed).
   */
  SETUP_ADMINS?: string;
  /**
   * Optional: Deep-Link zur Access-Policy der CMS-Applikation im Cloudflare-
   * Dashboard (account-/policy-spezifisch, daher Konfiguration statt Code).
   * Wird auf der Setup-Seite als "Nutzer verwalten"-Link angezeigt.
   */
  MANAGE_USERS_URL?: string;
  /** Durable-Object-Binding: Tresor fuer das Bot-Token-Paar (ADR 0011). */
  TOKEN_STORE: DurableObjectNamespace<TokenStore>;
}
