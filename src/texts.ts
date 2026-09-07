/**
 * Alle sichtbaren UI-Texte, lokalisiert (NFR-6, Styleguide §6/§7): Deutsch
 * als Default (Erst-Deployment-Zielgruppe; greift auch ohne
 * Accept-Language-Header), Englisch fuer alle Nicht-de-Browser.
 * Sie-Form / formal "you"; aktiv, ohne Technik-Jargon; Fehler nennen immer
 * den naechsten Schritt. HTML-Fragmente hier sind vertrauenswuerdige
 * Konstanten (keine Nutzereingaben).
 */

export interface Texts {
  lang: 'de' | 'en';
  eyebrow: string;
  eyebrowAdmin: string;
  selection: { title: string; github: string; email: string; hint: string };
  missingConfig: { title: string; intro: string; next: string };
  noAllowedDomains: { title: string; text: string };
  unsupportedDomain: { title: string; text: string; detailLabel: string };
  accessUnauthorized: { title: string; text: string };
  callbackSuccess: { title: string; text: string };
  callbackError: {
    title: string;
    notConnected: string;
    githubFailed: string;
    setupIncomplete: string;
    loginDisabled: string;
  };
  setup: {
    title: string;
    statusConnected: (expiresIso: string) => string;
    statusNotConnected: string;
    manageTitle: string;
    manageButton: string;
    manageButtonTitle: string;
    manageHint: string;
    manageFallback: string;
    connectTitle: string;
    connectIntro: string;
    connectButton: string;
    rotateButton: string;
    rotateOk: string;
    rotateFail: string;
    flowStep1: string;
    flowStep2: string;
    flowWaiting: string;
    startFailed: string;
    connected: string;
    failed: string;
    accessDenied: string;
    adminsOnly: string;
    locked: string;
  };
  setupIncomplete: { title: string; text: string; linkLabel: string };
  wizard: {
    title: string;
    stepLabels: [string, string, string, string, string, string, string];
    step1: { title: string; intro: string; audLabel: string; confirm: string };
    step2: {
      title: string;
      intro: string;
      guide: string;
      clientIdLabel: string;
      save: string;
    };
    connect: { title: string; intro: string; button: string };
    step3: {
      title: string;
      intro: string;
      domainsLabel: string;
      domainsPlaceholder: string;
      addDomain: string;
      removeDomain: string;
      save: string;
      invalidDomain: string;
      emptyDomains: string;
    };
    step4: {
      title: string;
      intro: string;
      urlLabel: string;
      placeholder: string;
      save: string;
      skip: string;
      invalidUrl: string;
    };
    step5: {
      title: string;
      intro: string;
      urlLabel: string;
      placeholder: string;
      save: string;
      skip: string;
      invalidUrl: string;
    };
    step6: { title: string; summary: string; configYmlHint: string; copyConfig: string; copied: string; goToDashboard: string };
    errorPrefix: string;
  };
  dashboard: {
    brand: string;
    signedInAs: (email: string) => string;
    accountMenuLabel: string;
    signOut: string;
    navUsers: string;
    navGithub: string;
    navSettings: string;
    usersTitle: string;
    usersText: string;
    usersHistoryTitle: string;
    usersEmpty: string;
    userColEmail: string;
    userColFirst: string;
    userColLast: string;
    usersClear: string;
    usersClearHint: string;
    usersClearConfirm: string;
    userDelete: string;
    userDeleteConfirm: string;
    settingsTitle: string;
    settingsFootnote: string;
    fieldAccessAppAud: string;
    fieldGithubAppClientId: string;
    fieldAllowedDomains: string;
    fieldGithubAuthUrl: string;
    fieldManageEditorsUrl: string;
    notSet: string;
    editTitle: string;
    saveButton: string;
    cancelButton: string;
    audResetIntro: string;
    audResetConfirm: string;
    domainsPlaceholder: string;
    urlPlaceholder: string;
    githubTitle: string;
    statusLabel: string;
    connectedBadge: string;
    notConnectedBadge: string;
    accountLabel: string;
    installationsLabel: (count: number) => string;
    tokenLabel: string;
    tokenShow: string;
    tokenHide: string;
    tokenValidLabel: string;
    nextRotationLabel: string;
    tokenValidUntil: (expiresIso: string) => string;
    rotationHint: string;
    reconnectButton: string;
    disconnectButton: string;
    disconnectHint: string;
    loginToggleLabel: string;
    loginActiveBadge: string;
    loginDisabledBadge: string;
    loginToggleHint: string;
    loginDisableConfirm: string;
    collapseLabel: string;
    toggleMenuTitle: string;
    navAudit: string;
    auditTitle: string;
    auditText: string;
    auditEmpty: string;
    auditColTime: string;
    auditColActor: string;
    auditColType: string;
    auditRetentionNote: string;
    eventSettingsUpdated: string;
    eventBotConnected: string;
    eventBotDisconnected: string;
    eventTokenRotated: string;
    eventTokenRotateFailed: string;
    eventLoginDisabled: string;
    eventLoginEnabled: string;
  };
}

const de: Texts = {
  lang: 'de',
  eyebrow: 'Anmelden',
  eyebrowAdmin: 'Anmelden · Verwaltung',
  selection: {
    title: 'Wie möchten Sie sich anmelden?',
    github: 'Mit GitHub anmelden',
    email: 'Mit E-Mail-Code anmelden',
    hint: 'Sie erhalten den Einmal-Code an Ihre E-Mail-Adresse, wenn diese für die Website freigeschaltet ist.',
  },
  missingConfig: {
    title: 'Konfigurationsfehler',
    intro:
      'Der E-Mail-Login ist nicht vollständig konfiguriert. Folgende Werte fehlen oder sind leer:',
    next: 'Bitte informieren Sie den Betreiber dieses Dienstes.',
  },
  noAllowedDomains: {
    title: 'Konfigurationsfehler',
    text: 'Die Anmeldung ist deaktiviert, weil keine erlaubten Domains konfiguriert sind. Bitte informieren Sie den Betreiber dieses Dienstes.',
  },
  unsupportedDomain: {
    title: 'Diese Website ist nicht freigeschaltet',
    text: 'Die Anmeldung ist für diese Website nicht eingerichtet. Bitte informieren Sie den Betreiber dieses Dienstes.',
    detailLabel: 'Technisches Detail:',
  },
  accessUnauthorized: {
    title: 'Nicht angemeldet',
    text: 'Der Zugriff wurde abgelehnt. Bitte melden Sie sich erneut an.',
  },
  callbackSuccess: {
    title: 'Anmeldung erfolgreich',
    text: 'Sie werden angemeldet … Dieses Fenster schließt sich gleich von selbst.',
  },
  callbackError: {
    title: 'Anmeldung fehlgeschlagen',
    notConnected:
      'Der Dienst ist noch nicht mit GitHub verbunden. Bitte den Betreiber informieren (Einrichtung unter /setup/github).',
    githubFailed:
      'Die Anmeldung bei GitHub ist fehlgeschlagen. Bitte in ein paar Minuten erneut versuchen; bleibt der Fehler, den Betreiber informieren.',
    setupIncomplete:
      'Die Einrichtung ist noch nicht abgeschlossen (fehlendes AUD oder fehlende GitHub-App-Client-ID). Bitte den Betreiber informieren (Einrichtung unter /setup).',
    loginDisabled:
      'Die Anmeldung ist derzeit vom Betreiber deaktiviert. Bitte spaeter erneut versuchen oder den Betreiber informieren.',
  },
  setup: {
    title: 'GitHub-Verbindung einrichten',
    statusConnected: (expiresIso) =>
      `<strong>Status:</strong> Verbunden. Aktuelles Token gültig bis ${expiresIso} (Rotation um 0/6/12/18 Uhr UTC). Eine erneute Verbindung ersetzt die bestehende Autorisierung.`,
    statusNotConnected: '<strong>Status:</strong> Noch nicht mit GitHub verbunden.',
    manageTitle: 'Benutzer verwalten',
    manageButton: 'Benutzer verwalten',
    manageButtonTitle: 'Policy im Cloudflare-Dashboard oeffnen',
    manageHint:
      'Öffnet die Access-Policy (Regel <em>Include &rarr; Emails</em>): Adresse hinzufügen/entfernen, speichern — Entzug wirkt nach Ablauf von Access-Session + Token.',
    manageFallback:
      'Im Cloudflare-Dashboard: Konto &rarr; Zero Trust &rarr; Access controls &rarr; Policies &rarr; CMS-Policy &rarr; Regel <em>Include &rarr; Emails</em>. Tipp: die Policy-URL als <code>MANAGE_EDITORS_URL</code> konfigurieren, dann erscheint hier ein Button.',
    connectTitle: 'GitHub-Verbindung',
    connectIntro:
      'Diese Einrichtung einmalig als <strong>Bot-Account</strong> durchführen (nicht mit dem persönlichen GitHub-Account!): Der Bot muss Collaborator des Ziel-Repos sein und die GitHub App autorisieren.',
    connectButton: 'Mit GitHub verbinden',
    rotateButton: 'Token jetzt rotieren',
    rotateOk:
      'Rotiert: Alle ausgegebenen Tokens sind jetzt ungültig; Anmeldungen erhalten ab sofort das neue Token.',
    rotateFail: 'Rotation fehlgeschlagen: ',
    flowStep1: '1. Diesen Code kopieren:',
    flowStep2:
      '— als Bot-Account anmelden, Code eingeben, App autorisieren.',
    flowWaiting: 'Warte auf Autorisierung …',
    startFailed: 'Start fehlgeschlagen: ',
    connected: 'Verbunden! Der E-Mail-Login ist jetzt einsatzbereit.',
    failed: 'Fehlgeschlagen: ',
    accessDenied: 'Zugriff verweigert.',
    adminsOnly: 'Zugriff verweigert: Diese Seite ist Administratoren vorbehalten.',
    locked:
      'Setup ist deaktiviert: Es sind keine Administratoren konfiguriert (SETUP_ADMINS).',
  },
  setupIncomplete: {
    title: 'Einrichtung unvollständig',
    text: 'Der Benutzer-Login ist noch nicht vollständig eingerichtet. Bitte informieren Sie den Betreiber dieses Dienstes.',
    linkLabel: 'Zur Einrichtung',
  },
  wizard: {
    title: 'Einrichtung',
    stepLabels: [
      'App festlegen',
      'GitHub App',
      'Bot verbinden',
      'Website freischalten',
      'GitHub-Login (optional)',
      'Benutzer-Link (optional)',
      'Fertig',
    ],
    step1: {
      title: 'App festlegen',
      intro:
        'Dieses JWT stammt von der Access-Applikation, über die Sie sich gerade angemeldet haben. Nach Bestätigung akzeptiert der Dienst dauerhaft nur noch diese Applikation (Trust-on-First-Use).',
      audLabel: 'Präsentiertes AUD:',
      confirm: 'AUD bestätigen und pinnen',
    },
    step2: {
      title: 'GitHub App',
      intro:
        'Der Dienst schreibt über einen <strong>Bot-Account</strong> ins Website-Repository. Dafür braucht er die Client-ID Ihrer GitHub App.',
      guide:
        'Noch keine App? GitHub &rarr; Settings &rarr; Developer settings &rarr; GitHub Apps &rarr; New: Webhook aus, Permission <em>Contents: Read &amp; write</em>, danach <em>Enable Device Flow</em> aktivieren — die Client-ID steht oben auf der App-Seite.',
      clientIdLabel: 'Client-ID der GitHub App',
      save: 'Client-ID speichern',
    },
    connect: {
      title: 'Bot verbinden',
      intro:
        'Autorisieren Sie die GitHub App jetzt einmalig als <strong>Bot-Account</strong> (nicht mit Ihrem persönlichen GitHub-Konto!): Der Bot muss Collaborator des Ziel-Repos sein. Beim Klick erscheint ein Geräte-Code.',
      button: 'Bot verbinden',
    },
    step3: {
      title: 'Website freischalten',
      intro:
        'Kommagetrennte Liste der Domains, von denen aus Benutzer sich anmelden dürfen (Ihre Sveltia-CMS-Website).',
      domainsLabel: 'Erlaubte Domains',
      domainsPlaceholder: 'meine-website.de',
      addDomain: 'Weitere Domain',
      removeDomain: 'Domain entfernen',
      save: 'Speichern',
      invalidDomain: 'Ungültige Domain (kein Schema, kein Pfad erlaubt): ',
      emptyDomains: 'Bitte mindestens eine Domain angeben.',
    },
    step4: {
      title: 'GitHub-Login-Weg (optional)',
      intro:
        'Optional: URL eines separat betriebenen <a href="https://github.com/sveltia/sveltia-cms-auth" target="_blank" rel="noopener">sveltia-cms-auth</a> für den GitHub-Anmeldeweg. Ohne diese URL steht nur der E-Mail-Weg zur Verfügung.',
      urlLabel: 'sveltia-cms-auth-URL',
      placeholder: 'https://auth.example.net',
      save: 'Speichern',
      skip: 'Überspringen',
      invalidUrl: 'Bitte eine gültige https-URL angeben.',
    },
    step5: {
      title: 'Benutzer-Link (optional)',
      intro:
        'Optional: Deep-Link zur Access-Policy im Cloudflare-Dashboard, damit „Benutzer verwalten" direkt dorthin führt.',
      urlLabel: 'Policy-URL',
      placeholder: 'https://dash.cloudflare.com/…',
      save: 'Speichern',
      skip: 'Überspringen',
      invalidUrl: 'Bitte eine gültige https-URL angeben.',
    },
    step6: {
      title: 'Fertig',
      summary:
        'Die Einrichtung ist abgeschlossen. Der E-Mail-Login ist einsatzbereit.',
      configYmlHint:
        'Tragen Sie dies in die Sveltia-<code>config.yml</code> Ihrer Website ein (<code>repo</code> anpassen):',
      copyConfig: 'Konfiguration kopieren',
      copied: 'Kopiert!',
      goToDashboard: 'Zur Verwaltung',
    },
    errorPrefix: 'Fehler: ',
  },
  dashboard: {
    brand: 'Sveltia CMS Cloudflare Access',
    signedInAs: (email) => `Angemeldet als ${email}`,
    accountMenuLabel: 'Konto-Menü',
    signOut: 'Abmelden',
    navUsers: 'Benutzer',
    navGithub: 'GitHub-Verbindung',
    navSettings: 'Einstellungen',
    usersTitle: 'Benutzer',
    usersText: 'Wer sich anmelden darf, wird nicht hier, sondern in der Policy Ihrer Cloudflare-Access-Anwendung gepflegt (siehe „Benutzer verwalten"). Die Liste unten ist nur ein Anmeldeverlauf (Audit-Log) und beeinflusst den Zugang nicht.',
    usersHistoryTitle: 'Anmeldeverlauf',
    usersEmpty: 'Noch hat sich niemand angemeldet.',
    userColEmail: 'E-Mail',
    userColFirst: 'Erste Anmeldung',
    userColLast: 'Letzte Anmeldung',
    usersClear: 'Verlauf löschen',
    usersClearHint: 'Löscht die gespeicherten Anmeldedaten aller Benutzer (Datenschutz).',
    usersClearConfirm: 'Den gesamten Anmeldeverlauf unwiderruflich löschen?',
    userDelete: 'Diesen Benutzer aus dem Verlauf löschen',
    userDeleteConfirm: 'Anmeldeverlauf von %s löschen?',
    settingsTitle: 'Einstellungen',
    settingsFootnote:
      'Zwei Werte kommen aus der Worker-Konfiguration (<code>ACCESS_TEAM_DOMAIN</code>, <code>SETUP_ADMINS</code>) und sind hier nicht änderbar.',
    fieldAccessAppAud: 'AUD (Access-Applikation)',
    fieldGithubAppClientId: 'Client-ID der GitHub App',
    fieldAllowedDomains: 'Erlaubte Domains',
    fieldGithubAuthUrl: 'sveltia-cms-auth-URL',
    fieldManageEditorsUrl: 'Benutzer verwalten (Cloudflare-Link)',
    notSet: 'nicht gesetzt',
    editTitle: 'Ändern',
    saveButton: 'Speichern',
    cancelButton: 'Abbrechen',
    audResetIntro:
      'Das aktuell von der Access-Applikation präsentierte AUD (aus Ihrem JWT). Zum Neu-Pinnen bestätigen — keine freie Eingabe möglich.',
    audResetConfirm: 'Dieses AUD neu festlegen',
    domainsPlaceholder: 'cms.example.com, www.example.com',
    urlPlaceholder: 'https://…',
    githubTitle: 'GitHub-Verbindung',
    statusLabel: 'Status',
    connectedBadge: 'Verbunden',
    notConnectedBadge: 'Nicht verbunden',
    accountLabel: 'Verbundenes Konto',
    installationsLabel: (count) => `${count} erreichbare Installation${count === 1 ? '' : 'en'}`,
    tokenLabel: 'Aktuelles Token',
    tokenShow: 'Token anzeigen',
    tokenHide: 'Token verbergen',
    tokenValidLabel: 'Gültig bis',
    nextRotationLabel: 'Nächste Rotation',
    tokenValidUntil: (expiresIso) => `Token gültig bis ${expiresIso}`,
    rotationHint: 'Rotation um 0/6/12/18 Uhr UTC',
    reconnectButton: 'Neu verbinden',
    disconnectButton: 'Verbindung trennen',
    disconnectHint: 'Löscht das gespeicherte Token-Paar; der Wizard fragt die Verbindung danach neu ab. Vollständiger Widerruf: GitHub-Einstellungen des Bot-Accounts.',
    loginToggleLabel: 'CMS Login',
    loginActiveBadge: 'Aktiv',
    loginDisabledBadge: 'Deaktiviert',
    loginToggleHint: 'Steuert die Anmeldung am CMS. Deaktivieren wirkt sofort — auch für bereits offene Sessions bekommt niemand mehr ein Token (für Wartungsfenster oder als Notbremse). Der Zugang zu dieser Einstellungsseite bleibt davon unberührt. Der interne Token-Refresh läuft weiter; Aktivieren stellt den Normalbetrieb sofort wieder her.',
    loginDisableConfirm: 'CMS-Login wirklich deaktivieren? Danach kann sich niemand mehr am CMS anmelden, bis du ihn wieder aktivierst.',
    collapseLabel: 'Einklappen',
    toggleMenuTitle: 'Menü ein-/ausklappen',
    navAudit: 'Audit-Log',
    auditTitle: 'Audit-Log',
    auditText:
      'Unveränderliche Sicherheitsereignisse (wer wann was geändert hat) — ohne Tokenwerte, nicht löschbar. Ergänzt den Anmeldeverlauf.',
    auditEmpty: 'Noch keine Ereignisse.',
    auditColTime: 'Zeit',
    auditColActor: 'Akteur',
    auditColType: 'Ereignis',
    auditRetentionNote: 'Die letzten 200 Ereignisse werden vorgehalten.',
    eventSettingsUpdated: 'Einstellungen geändert',
    eventBotConnected: 'Bot verbunden',
    eventBotDisconnected: 'Verbindung getrennt',
    eventTokenRotated: 'Token rotiert',
    eventTokenRotateFailed: 'Token-Rotation fehlgeschlagen',
    eventLoginDisabled: 'Login deaktiviert',
    eventLoginEnabled: 'Login aktiviert',
  },
};

const en: Texts = {
  lang: 'en',
  eyebrow: 'Sign in',
  eyebrowAdmin: 'Sign in · Administration',
  selection: {
    title: 'How would you like to sign in?',
    github: 'Sign in with GitHub',
    email: 'Sign in with email code',
    hint: 'You will receive a one-time code at your email address if it has been approved for this website.',
  },
  missingConfig: {
    title: 'Configuration error',
    intro: 'Email sign-in is not fully configured. The following values are missing or empty:',
    next: 'Please contact the operator of this service.',
  },
  noAllowedDomains: {
    title: 'Configuration error',
    text: 'Sign-in is disabled because no allowed domains are configured. Please contact the operator of this service.',
  },
  unsupportedDomain: {
    title: 'This website is not approved',
    text: 'Sign-in is not set up for this website. Please contact the operator of this service.',
    detailLabel: 'Technical detail:',
  },
  accessUnauthorized: {
    title: 'Not signed in',
    text: 'Access was denied. Please sign in again.',
  },
  callbackSuccess: {
    title: 'Signed in successfully',
    text: 'Signing you in … This window will close by itself in a moment.',
  },
  callbackError: {
    title: 'Sign-in failed',
    notConnected:
      'This service is not connected to GitHub yet. Please contact the operator (setup at /setup/github).',
    githubFailed:
      'Signing in to GitHub failed. Please try again in a few minutes; if the error persists, contact the operator.',
    setupIncomplete:
      'Setup is not complete yet (missing AUD or missing GitHub App client ID). Please contact the operator (setup at /setup).',
    loginDisabled:
      'Sign-in is currently disabled by the operator. Please try again later or contact the operator.',
  },
  setup: {
    title: 'Set up the GitHub connection',
    statusConnected: (expiresIso) =>
      `<strong>Status:</strong> Connected. Current token valid until ${expiresIso} (rotation at 00/06/12/18 UTC). Connecting again replaces the existing authorization.`,
    statusNotConnected: '<strong>Status:</strong> Not connected to GitHub yet.',
    manageTitle: 'Manage users',
    manageButton: 'Manage users',
    manageButtonTitle: 'Open the policy in the Cloudflare dashboard',
    manageHint:
      'Opens the Access policy (rule <em>Include &rarr; Emails</em>): add or remove an address and save — removal takes effect after the Access session + token expire.',
    manageFallback:
      'In the Cloudflare dashboard: account &rarr; Zero Trust &rarr; Access controls &rarr; Policies &rarr; the CMS policy &rarr; rule <em>Include &rarr; Emails</em>. Tip: configure the policy URL as <code>MANAGE_EDITORS_URL</code> to get a button here.',
    connectTitle: 'GitHub connection',
    connectIntro:
      'Do this once as the <strong>bot account</strong> (not your personal GitHub account!): the bot must be a collaborator on the target repository and authorize the GitHub App.',
    connectButton: 'Connect GitHub',
    rotateButton: 'Rotate token now',
    rotateOk:
      'Rotated: all issued tokens are now invalid; sign-ins receive the new token from now on.',
    rotateFail: 'Rotation failed: ',
    flowStep1: '1. Copy this code:',
    flowStep2: '— sign in as the bot account, enter the code, authorize the app.',
    flowWaiting: 'Waiting for authorization …',
    startFailed: 'Start failed: ',
    connected: 'Connected! Email sign-in is ready to use.',
    failed: 'Failed: ',
    accessDenied: 'Access denied.',
    adminsOnly: 'Access denied: this page is restricted to administrators.',
    locked: 'Setup is disabled: no administrators are configured (SETUP_ADMINS).',
  },
  setupIncomplete: {
    title: 'Setup incomplete',
    text: 'User sign-in is not fully set up yet. Please contact the operator of this service.',
    linkLabel: 'Go to setup',
  },
  wizard: {
    title: 'Setup',
    stepLabels: [
      'Set the app',
      'GitHub app',
      'Connect bot',
      'Approve a website',
      'GitHub sign-in (optional)',
      'Users link (optional)',
      'Done',
    ],
    step1: {
      title: 'Set the app',
      intro:
        'This JWT comes from the Access application you just signed in with. Once confirmed, the service permanently accepts only this application (trust on first use).',
      audLabel: 'Presented AUD:',
      confirm: 'Confirm and pin AUD',
    },
    step2: {
      title: 'GitHub app',
      intro:
        'The service writes to the website repository through a <strong>bot account</strong>. It needs the client ID of your GitHub App for that.',
      guide:
        'No app yet? GitHub &rarr; Settings &rarr; Developer settings &rarr; GitHub Apps &rarr; New: webhook off, permission <em>Contents: Read &amp; write</em>, then enable <em>Enable Device Flow</em> — the client ID is shown at the top of the app page.',
      clientIdLabel: 'GitHub App client ID',
      save: 'Save client ID',
    },
    connect: {
      title: 'Connect the bot',
      intro:
        'Now authorize the GitHub App once as the <strong>bot account</strong> (not your personal GitHub account!): the bot must be a collaborator on the target repository. Clicking the button shows a device code.',
      button: 'Connect bot',
    },
    step3: {
      title: 'Approve a website',
      intro:
        'Comma-separated list of domains users are allowed to sign in from (your Sveltia CMS website).',
      domainsLabel: 'Allowed domains',
      domainsPlaceholder: 'my-website.org',
      addDomain: 'Add another domain',
      removeDomain: 'Remove domain',
      save: 'Save',
      invalidDomain: 'Invalid domain (no scheme, no path allowed): ',
      emptyDomains: 'Please provide at least one domain.',
    },
    step4: {
      title: 'GitHub sign-in (optional)',
      intro:
        'Optional: URL of a separately hosted <a href="https://github.com/sveltia/sveltia-cms-auth" target="_blank" rel="noopener">sveltia-cms-auth</a> for the GitHub sign-in path. Without this URL, only the email path is available.',
      urlLabel: 'sveltia-cms-auth URL',
      placeholder: 'https://auth.example.net',
      save: 'Save',
      skip: 'Skip',
      invalidUrl: 'Please provide a valid https URL.',
    },
    step5: {
      title: 'Users link (optional)',
      intro:
        'Optional: deep link to the Access policy in the Cloudflare dashboard, so "Manage users" points there directly.',
      urlLabel: 'Policy URL',
      placeholder: 'https://dash.cloudflare.com/…',
      save: 'Save',
      skip: 'Skip',
      invalidUrl: 'Please provide a valid https URL.',
    },
    step6: {
      title: 'Done',
      summary: 'Setup is complete. Email sign-in is ready to use.',
      configYmlHint:
        'Add this to your website\'s Sveltia <code>config.yml</code> (adjust <code>repo</code>):',
      copyConfig: 'Copy configuration',
      copied: 'Copied!',
      goToDashboard: 'Go to administration',
    },
    errorPrefix: 'Error: ',
  },
  dashboard: {
    brand: 'Sveltia CMS Cloudflare Access',
    signedInAs: (email) => `Signed in as ${email}`,
    accountMenuLabel: 'Account menu',
    signOut: 'Sign out',
    navUsers: 'Users',
    navGithub: 'GitHub connection',
    navSettings: 'Settings',
    usersTitle: 'Users',
    usersText: 'Who may sign in is managed not here but in your Cloudflare Access application\'s policy (see "Manage users"). The list below is only a sign-in history (audit log) and does not affect access.',
    usersHistoryTitle: 'Sign-in history',
    usersEmpty: 'Nobody has signed in yet.',
    userColEmail: 'Email',
    userColFirst: 'First sign-in',
    userColLast: 'Last sign-in',
    usersClear: 'Clear history',
    usersClearHint: 'Deletes the stored sign-in data of all users (privacy).',
    usersClearConfirm: 'Permanently delete the entire sign-in history?',
    userDelete: 'Remove this user from the history',
    userDeleteConfirm: 'Delete the sign-in history of %s?',
    settingsTitle: 'Settings',
    settingsFootnote:
      'Two values come from the worker configuration (<code>ACCESS_TEAM_DOMAIN</code>, <code>SETUP_ADMINS</code>) and cannot be changed here.',
    fieldAccessAppAud: 'AUD (Access application)',
    fieldGithubAppClientId: 'GitHub App client ID',
    fieldAllowedDomains: 'Allowed domains',
    fieldGithubAuthUrl: 'sveltia-cms-auth URL',
    fieldManageEditorsUrl: 'Manage users (Cloudflare link)',
    notSet: 'not set',
    editTitle: 'Change',
    saveButton: 'Save',
    cancelButton: 'Cancel',
    audResetIntro:
      'The AUD currently presented by the Access application (from your JWT). Confirm to re-pin it — no free-text entry is possible.',
    audResetConfirm: 'Re-pin this AUD',
    domainsPlaceholder: 'cms.example.com, www.example.com',
    urlPlaceholder: 'https://…',
    githubTitle: 'GitHub connection',
    statusLabel: 'Status',
    connectedBadge: 'Connected',
    notConnectedBadge: 'Not connected',
    accountLabel: 'Connected account',
    installationsLabel: (count) => `${count} reachable installation${count === 1 ? '' : 's'}`,
    tokenLabel: 'Current token',
    tokenShow: 'Show token',
    tokenHide: 'Hide token',
    tokenValidLabel: 'Valid until',
    nextRotationLabel: 'Next rotation',
    tokenValidUntil: (expiresIso) => `Token valid until ${expiresIso}`,
    rotationHint: 'Rotation at 00/06/12/18 UTC',
    reconnectButton: 'Reconnect',
    disconnectButton: 'Disconnect',
    disconnectHint: 'Deletes the stored token pair; the wizard will ask to connect again. Full revocation: the bot account\'s GitHub settings.',
    loginToggleLabel: 'CMS login',
    loginActiveBadge: 'Enabled',
    loginDisabledBadge: 'Disabled',
    loginToggleHint: 'Controls signing in to the CMS. Disabling takes effect immediately — even live sessions stop receiving tokens (for maintenance windows or as an emergency brake). Access to this settings page is unaffected. The internal token refresh keeps running; enabling restores normal operation right away.',
    loginDisableConfirm: 'Really disable CMS login? Nobody will be able to sign in to the CMS until you enable it again.',
    collapseLabel: 'Collapse',
    toggleMenuTitle: 'Collapse/expand menu',
    navAudit: 'Audit log',
    auditTitle: 'Audit log',
    auditText:
      'Immutable security events (who changed what, when) — no token values, not deletable. Complements the sign-in history.',
    auditEmpty: 'No events yet.',
    auditColTime: 'Time',
    auditColActor: 'Actor',
    auditColType: 'Event',
    auditRetentionNote: 'The most recent 200 events are retained.',
    eventSettingsUpdated: 'Settings changed',
    eventBotConnected: 'Bot connected',
    eventBotDisconnected: 'Disconnected',
    eventTokenRotated: 'Token rotated',
    eventTokenRotateFailed: 'Token rotation failed',
    eventLoginDisabled: 'Sign-in disabled',
    eventLoginEnabled: 'Sign-in enabled',
  },
};

/**
 * Waehlt die Sprache aus dem Accept-Language-Header: Der am hoechsten
 * gewichtete unterstuetzte Sprach-Tag gewinnt; Deutsch nur, wenn `de`
 * bevorzugt wird, sonst Englisch. Ohne Header: Deutsch (Default des
 * Referenz-Deployments; dokumentiert).
 */
export function pickTexts(acceptLanguage: string | null): Texts {
  if (acceptLanguage === null || acceptLanguage.trim() === '') {
    return de;
  }

  const tags = acceptLanguage
    .split(',')
    .map((entry) => {
      const [tag = '', ...params] = entry.trim().split(';');
      const qParam = params.find((param) => param.trim().startsWith('q='));
      const q = qParam ? Number.parseFloat(qParam.trim().slice(2)) : 1;

      return { lang: tag.trim().toLowerCase(), q: Number.isFinite(q) ? q : 0 };
    })
    .filter((entry) => entry.lang !== '')
    .sort((a, b) => b.q - a.q);

  for (const { lang } of tags) {
    if (lang === 'de' || lang.startsWith('de-')) {
      return de;
    }

    if (lang === 'en' || lang.startsWith('en-') || lang === '*') {
      return en;
    }
  }

  return en;
}
