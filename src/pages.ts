import { buildAllowedOrigins } from './config.js';
import type { LoadedConfig, MissingRequiredConfig } from './config.js';
import type { Texts } from './texts.js';
import type { AuditEvent, TokenStoreStatus, UserRecord } from './token-store.js';

/**
 * Design-Tokens und Komponentenstile (design-system-001, abgenommen
 * 2026-09-04): aus Sveltias UI-Bibliothek abgeleitet (Hue 210), hell/dunkel
 * via prefers-color-scheme, System-Font-Stack (asset-frei), 4px-Radius.
 * Texte kommen lokalisiert aus `texts.ts` (Accept-Language, NFR-6).
 */
const BASE_STYLE = `
  :root {
    --hue: 210;
    --bg: hsl(var(--hue) 20% 98%);
    --surface: hsl(var(--hue) 15% 100%);
    --border: hsl(var(--hue) 10% 82%);
    --text: hsl(var(--hue) 15% 15%);
    --text-2: hsl(var(--hue) 8% 40%);
    --accent: hsl(var(--hue) 100% 40%);
    --accent-hover: hsl(var(--hue) 100% 35%);
    --on-accent: #fff;
    --warn: hsl(25 90% 45%);
    --ok: hsl(150 60% 38%);
    --danger: hsl(0 72% 45%);
    --danger-hover: hsl(0 72% 38%);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: hsl(var(--hue) 10% 8%);
      --surface: hsl(var(--hue) 10% 13%);
      --border: hsl(var(--hue) 10% 24%);
      --text: hsl(var(--hue) 10% 88%);
      --text-2: hsl(var(--hue) 10% 65%);
      --accent-hover: hsl(var(--hue) 100% 46%);
      --warn: hsl(25 90% 55%);
      --ok: hsl(150 55% 55%);
      --danger: hsl(0 75% 62%);
      --danger-hover: hsl(0 75% 68%);
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
         font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         min-height: 100dvh; display: flex; flex-direction: column; }
  .popup-center { flex: 1; display: grid; place-content: center; width: 100%; }
  main { max-width: 340px; padding: 24px; }
  .site-footer { margin-top: auto; padding: 14px 20px; text-align: center;
                 font-size: 12px; color: var(--text-2); border-top: 1px solid var(--border); }
  .site-footer a { color: var(--text-2); text-decoration: underline; }
  .site-footer a:hover { color: var(--accent); }
  .site-footer .heart { color: hsl(0 72% 55%); }
  main.wide { max-width: 560px; }
  .eyebrow { font-size: 12px; color: var(--text-2); letter-spacing: .02em; margin: 0 0 8px; }
  h1 { font-size: 20px; font-weight: 600; margin: 0 0 10px; }
  h2 { font-size: 16px; font-weight: 600; margin: 20px 0 8px; }
  p { margin: 0 0 14px; }
  .muted { color: var(--text-2); font-size: 13px; }
  code { font: 13px ui-monospace, monospace; background: var(--surface);
         border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; }
  ul { margin: 0 0 14px; padding-left: 20px; }
  a { color: var(--accent); }
  .way { display: flex; align-items: center; justify-content: center; gap: 10px;
         width: 100%; padding: 10px 14px; border-radius: 4px; margin: 0 0 10px;
         font: inherit; font-size: 15px; font-weight: 600; cursor: pointer;
         text-decoration: none; transition: all 120ms; }
  @media (prefers-reduced-motion: reduce) { .way { transition: none; } }
  .way svg { flex: 0 0 auto; width: 20px; height: 20px; }
  .way-primary { background: var(--accent); color: var(--on-accent); border: 1px solid var(--accent); }
  .way-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
  .way-secondary { background: var(--surface); color: var(--text); border: 1px solid var(--border); }
  .way-secondary:hover { border-color: var(--accent); }
  .way:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .error-block { border-left: 3px solid var(--warn); padding-left: 12px; }
`;

/** GitHub-Mark (offizieller Octocat-Pfad), Brief- und Personen-Icon —
 * Inline-SVG, currentColor, aria-hidden (Styleguide §4). */
const ICON_GITHUB = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.333-1.754-1.333-1.754-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>`;
const ICON_MAIL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>`;
const ICON_USERS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5"/><circle cx="17" cy="9" r="2.4"/><path d="M16.5 14.7c2.2.2 3.6 1.5 4 3.8"/></svg>`;
const ICON_GEAR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.12-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.12 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.09a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.87Z"/></svg>`;
const ICON_PENCIL = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`;
const ICON_EYE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;
const ICON_TRASH = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"/></svg>`;
const ICON_EYE_OFF = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.9 4.2A11 11 0 0 1 12 4c7 0 11 8 11 8a19 19 0 0 1-3 3.9M6.1 6.1A19 19 0 0 0 1 12s4 8 11 8a11 11 0 0 0 5-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M1 1l22 22"/></svg>`;
const ICON_CHEVRON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>`;
const ICON_AUDIT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4h6a2 2 0 0 1 2 2v13l-3-2-2 2-2-2-3 2V6a2 2 0 0 1 2-2Z"/><path d="M9.5 9h5M9.5 12.5h5"/></svg>`;

/**
 * Zusaetzliche Design-Tokens fuer Wizard + Verwaltung (design-system-001,
 * Admin-Preview 2026-09-04, samt Amendments zum Sidebar-Einklapp-Verhalten):
 * eigener Style-Block, NUR fuer `/setup` genutzt — die Popup-Seiten
 * (BASE_STYLE) bleiben unveraendert.
 */
const ADMIN_STYLE = `
  *, *::before, *::after { box-sizing: border-box; }
  /* 64-Zeichen-Hex (AUD), Client-IDs und URLs haben keine Umbruchstellen —
     ohne das laufen sie auf schmalen Screens aus dem Layout. */
  code, .kv .v { overflow-wrap: anywhere; word-break: break-all; min-width: 0; }
  body.admin { display: block; place-content: unset; }
  /* Topbar/Sidebar full-bleed; nur der Inhalt ist auf Lesebreite begrenzt
     (User-Feedback: die Leiste oben muss durchgehen). */
  .admin-shell { min-height: 100dvh; display: flex; flex-direction: column; }
  .topbar { display: flex; justify-content: space-between; align-items: center;
            padding: 14px 28px; border-bottom: 1px solid var(--border); background: var(--surface); }
  .topbar .brand { font-weight: 600; display: flex; align-items: center; gap: 10px; }
  .topbar .who { font-size: 13px; color: var(--text-2); }
  .admin-inner { padding: 28px 20px; max-width: 1200px; margin: 0 auto; width: 100%; }
  .steps { display: flex; gap: 6px 8px; margin: 0 0 24px; padding: 0; list-style: none;
           font-size: 13px; flex-wrap: wrap; justify-content: center; }
  .steps li { display: flex; align-items: center; gap: 6px; color: var(--text-2); }
  .steps li::after { content: "→"; margin-left: 8px; opacity: .5; }
  .steps li:last-child::after { content: ""; }
  .steps .done { color: var(--ok); }
  .steps .active { color: var(--text); font-weight: 600; }
  .dot { width: 18px; height: 18px; border-radius: 50%; border: 1.5px solid currentColor;
         display: inline-grid; place-content: center; font-size: 11px; }
  .done .dot { background: var(--ok); border-color: var(--ok); color: #fff; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
          padding: 24px; margin: 0 0 20px; }
  .card h2 { font-size: 18px; margin: 0 0 8px; }
  label.field { display: block; font-size: 13px; color: var(--text-2); margin: 14px 0 4px; }
  input[type=text] { width: 100%; max-width: 420px; display: block; padding: 9px 12px; font: inherit;
         color: var(--text); background: var(--bg); border: 1px solid var(--border); border-radius: 4px; }
  input[type=text]:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .row { display: flex; gap: 10px; margin-top: 20px; align-items: center; flex-wrap: wrap; }
  .btn { display: inline-flex; align-items: center; gap: 8px; padding: 9px 16px; border-radius: 4px;
         transition: background 120ms, border-color 120ms, color 120ms;
         font: inherit; font-size: 15px; font-weight: 600; cursor: pointer; text-decoration: none;
         border: 1px solid var(--border); background: var(--surface); color: var(--text); }
  .btn:hover { border-color: var(--accent); color: var(--accent); }
  .btn-primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
  .btn-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); color: var(--on-accent); }
  .btn-ghost { border-color: transparent; color: var(--text-2); }
  .btn-ghost:hover { border-color: transparent; color: var(--text); background: color-mix(in srgb, var(--text) 8%, transparent); }
  .btn-danger { border-color: var(--danger); color: var(--danger); background: var(--surface); }
  .btn-danger:hover { background: var(--danger-hover); color: #fff; border-color: var(--danger-hover); }
  .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .shell { display: flex; flex: 1; }
  nav.side { width: 220px; flex: 0 0 auto; border-right: 1px solid var(--border);
             background: var(--surface); padding: 12px 8px; transition: width 160ms;
             display: flex; flex-direction: column; }
  .btn svg { flex: 0 0 auto; width: 18px; height: 18px; }
  @media (prefers-reduced-motion: reduce) { nav.side, .btn { transition: none; } }
  .shell.collapsed nav.side { width: 57px; }
  .navlist { flex: 1; display: flex; flex-direction: column; }
  nav.side .navbtn { display: flex; align-items: center; gap: 10px; width: 100%; height: 40px;
             padding: 0 11px; border: 0; background: none; color: var(--text-2); font: inherit;
             font-size: 14px; border-radius: 4px; cursor: pointer; text-align: left;
             white-space: nowrap; overflow: hidden; }
  nav.side .navbtn svg { flex: 0 0 auto; width: 18px; height: 18px; }
  nav.side .navbtn.active { background: color-mix(in srgb, var(--accent) 12%, transparent);
             color: var(--text); font-weight: 600; }
  nav.side .navbtn:hover { color: var(--text); }
  nav.side .navbtn:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .shell.collapsed nav.side .navbtn span { display: none; }
  .navtoggle svg { transition: transform 160ms; }
  @media (prefers-reduced-motion: reduce) { .navtoggle svg { transition: none; } }
  .shell.collapsed .navtoggle svg { transform: rotate(180deg); }
  .content { flex: 1; padding: 28px; min-width: 0; }
  .content .card { max-width: 1200px; }
  .kv { display: grid; grid-template-columns: 180px 1fr; gap: 8px 16px; align-items: center; font-size: 14px; }
  .kv .k { color: var(--text-2); }
  .kv .v { display: block; min-width: 0; }
  .kv .v .editlink { margin-left: 6px; vertical-align: middle; }
  .badge { display: inline-block; font-size: 12px; font-weight: 600; border-radius: 99px; padding: 2px 10px; }
  .badge.ok { background: color-mix(in srgb, var(--ok) 15%, transparent); color: var(--ok); }
  .editlink { color: var(--text-2); display: inline-flex; padding: 2px; border-radius: 4px;
              border: 0; background: none; cursor: pointer; }
  .editlink:hover { color: var(--accent); }
  .section { display: none; }
  .section.active { display: block; }
  form.editform { margin-top: 10px; grid-column: 1 / -1; }
  form.editform input[type=text] { margin-bottom: 0; }
  .subhead { font-size: 14px; font-weight: 600; margin: 20px 0 8px; }
  .tablewrap { overflow-x: auto; }
  .usertable { width: 100%; border-collapse: collapse; font-size: 14px; }
  .usertable th, .usertable td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--border); }
  .usertable th { color: var(--text-2); font-weight: 600; }
  .usertable tbody tr:last-child td { border-bottom: 0; }
  .usertable .sortbtn { background: none; border: 0; padding: 0; margin: 0; font: inherit;
                        font-weight: 600; color: var(--text-2); cursor: pointer; display: inline-flex;
                        align-items: center; gap: 4px; }
  .usertable .sortbtn:hover { color: var(--text); }
  .usertable .sortarrow { display: inline-flex; flex-direction: column; line-height: 1;
                          gap: 2px; font-size: 8px; margin-left: 3px; }
  .usertable .sortarrow .up, .usertable .sortarrow .down { opacity: .3; }
  .usertable .sortbtn:hover .sortarrow .up, .usertable .sortbtn:hover .sortarrow .down { opacity: .5; }
  .usertable .sortarrow .up.active, .usertable .sortarrow .down.active { opacity: 1; color: var(--accent); }
  .usercell-action { text-align: right; width: 1%; white-space: nowrap; }
  .editlink.danger:hover { color: var(--danger); }
  .codeblock { background: var(--bg); border: 1px solid var(--border); border-radius: 4px;
              padding: 12px 14px; overflow-x: auto; font: 13px ui-monospace, monospace;
              white-space: pre; margin: 0 0 8px; }
`;

const adminPage = (lang: string, title: string, inner: string): string => `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${BASE_STYLE}${ADMIN_STYLE}</style>
</head>
<body class="admin">
<div class="admin-shell">
${inner}
${footerHtml(lang)}
</div>
</body>
</html>`;

/**
 * Security-Header fuer alle vom Worker gerenderten Seiten: nicht cachebar (die
 * Seiten tragen teils Tokens/E-Mails), nicht einbettbar (Clickjacking-Schutz
 * per CSP + X-Frame-Options), kein MIME-Sniffing, kein Referrer-Leak.
 */
const SECURITY_HEADERS: Record<string, string> = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy': "frame-ancestors 'none'",
};

const adminHtmlResponse = (body: string, status = 200): Response =>
  new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
  });

const htmlResponse = (body: string, status = 200): Response =>
  new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
  });

const REPO_URL = 'https://github.com/hollesse/sveltia-cms-cloudflare-access-auth';

/** Gemeinsamer Footer fuer Popup- und Admin-Seiten (lokalisiert per lang). */
function footerHtml(_lang: string): string {
  return `<footer class="site-footer">Made with <span class="heart">\u2665</span> by <a href="https://joshuatoepfer.de" target="_blank" rel="noopener">Joshua T\u00f6pfer</a> · <a href="${REPO_URL}" target="_blank" rel="noopener">GitHub</a></footer>`;
}

const page = (lang: string, title: string, body: string, wide = false): string => `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${BASE_STYLE}</style>
</head>
<body>
<div class="popup-center">
<main${wide ? ' class="wide"' : ''}>
${body}
</main>
</div>
${footerHtml(lang)}
</body>
</html>`;

const eyebrow = (label: string, context?: string): string =>
  `<p class="eyebrow">${label}${context ? ` · ${escapeHtml(context)}` : ''}</p>`;

/** Fehlerseite fuer unvollstaendige Pflichtkonfiguration (ADR 0009). Nennt
 * niemals Werte, nur die Namen der fehlenden Keys. */
export function renderMissingConfigPage(config: MissingRequiredConfig, t: Texts): Response {
  const body = `${eyebrow(t.eyebrow)}
<div class="error-block">
<h1>${t.missingConfig.title}</h1>
<p>${t.missingConfig.intro}</p>
</div>
<ul>${config.missingKeys.map((key) => `<li><code>${escapeHtml(key)}</code></li>`).join('')}</ul>
<p>${t.missingConfig.next}</p>`;

  return htmlResponse(page(t.lang, t.missingConfig.title, body), 500);
}

/** Fehlerseite, wenn keine erlaubten Domains konfiguriert sind (Offene-Relay-
 * Schutz, deaktiviert beide Login-Wege). */
export function renderNoAllowedDomainsPage(t: Texts): Response {
  const body = `${eyebrow(t.eyebrow)}
<div class="error-block">
<h1>${t.noAllowedDomains.title}</h1>
<p>${t.noAllowedDomains.text}</p>
</div>
<p class="muted">${t.unsupportedDomain.detailLabel} <code>ALLOWED_DOMAINS</code></p>`;

  return htmlResponse(page(t.lang, t.noAllowedDomains.title, body), 500);
}

/** Eingangs-Gate: `site_id` matched keine erlaubte Domain (NFR-1). */
export function renderUnsupportedDomainPage(t: Texts): Response {
  const body = `${eyebrow(t.eyebrow)}
<div class="error-block">
<h1>${t.unsupportedDomain.title}</h1>
<p>${t.unsupportedDomain.text}</p>
</div>
<p class="muted">${t.unsupportedDomain.detailLabel} <code>UNSUPPORTED_DOMAIN</code></p>`;

  return htmlResponse(page(t.lang, t.unsupportedDomain.title, body), 403);
}

/**
 * Setup-Seite fuer die Einmal-Autorisierung des Bot-Accounts per GitHub
 * Device Flow (ADR 0011). Der Browser taktet das Polling; bei Erfolg legt
 * der Worker das Token-Paar im TokenStore-Durable-Object ab.
 * Nur fuer Setup-Admins erreichbar (ADR 0012).
 */
export function renderSetupPage(
  authorized: boolean,
  expiresAt: number | null,
  manageEditorsUrl: string | undefined,
  t: Texts,
): Response {
  const statusLine = authorized
    ? `<p>${t.setup.statusConnected(expiresAt ? new Date(expiresAt).toISOString() : '—')}</p>`
    : `<p>${t.setup.statusNotConnected}</p>`;

  const body = `${eyebrow(t.eyebrowAdmin)}
<h1>${t.setup.title}</h1>
${statusLine}
<h2>${t.setup.manageTitle}</h2>
${
  manageEditorsUrl
    ? `<a class="way way-secondary" href="${escapeHtmlAttribute(manageEditorsUrl)}" target="_blank" rel="noopener" title="${escapeHtmlAttribute(t.setup.manageButtonTitle)}">${ICON_USERS}<span>${t.setup.manageButton}</span></a>
<p class="muted">${t.setup.manageHint}</p>`
    : `<p class="muted">${t.setup.manageFallback}</p>`
}

<h2>${t.setup.connectTitle}</h2>
<p>${t.setup.connectIntro}</p>
<button class="way way-primary" id="start">${ICON_GITHUB}<span>${t.setup.connectButton}</span></button>
${
  authorized
    ? `<button class="way way-secondary" id="rotate">${t.setup.rotateButton}</button>
<p id="rotateStatus" class="muted"></p>
<script>
  document.getElementById('rotate').addEventListener('click', async () => {
    const res = await fetch('/setup/github/rotate', { method: 'POST' }).then((r) => r.json());
    document.getElementById('rotateStatus').textContent = res.ok
      ? ${JSON.stringify(t.setup.rotateOk)}
      : ${JSON.stringify(t.setup.rotateFail)} + res.reason;
  });
</script>`
    : ''
}
<div id="flow" hidden>
  <p>${t.setup.flowStep1} <strong id="code" style="font-size:1.5em"></strong></p>
  <p>2. <a id="verify" target="_blank" rel="noopener">github.com/login/device</a>
     ${t.setup.flowStep2}</p>
  <p id="status">${t.setup.flowWaiting}</p>
</div>
<script>
  const startBtn = document.getElementById('start');
  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    const started = await fetch('/setup/github/start', { method: 'POST' }).then((r) => r.json());
    if (!started.ok) {
      document.getElementById('status').textContent = ${JSON.stringify(t.setup.startFailed)} + started.reason;
      document.getElementById('flow').hidden = false;
      return;
    }
    document.getElementById('code').textContent = started.userCode;
    const link = document.getElementById('verify');
    link.href = started.verificationUri;
    document.getElementById('flow').hidden = false;
    let interval = (started.interval || 5) * 1000;
    const poll = async () => {
      const res = await fetch('/setup/github/poll', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceCode: started.deviceCode }),
      }).then((r) => r.json());
      if (res.ok) {
        document.getElementById('status').textContent = ${JSON.stringify(t.setup.connected)};
        return;
      }
      if (res.reason === 'slow_down') interval += 5000;
      if (res.reason === 'pending' || res.reason === 'slow_down') {
        setTimeout(poll, interval);
        return;
      }
      document.getElementById('status').textContent = ${JSON.stringify(t.setup.failed)} + res.reason;
    };
    setTimeout(poll, interval);
  });
</script>`;

  return htmlResponse(page(t.lang, t.setup.title, body, true));
}

/** Access-JWT fehlt, ist gefaelscht oder abgelaufen — harte Ablehnung. */
export function renderAccessUnauthorizedPage(t: Texts): Response {
  const body = `${eyebrow(t.eyebrow)}
<div class="error-block">
<h1>${t.accessUnauthorized.title}</h1>
<p>${t.accessUnauthorized.text}</p>
</div>`;

  return htmlResponse(page(t.lang, t.accessUnauthorized.title, body), 401);
}

/**
 * Auswahlseite (design-system-001): zwei gleichrangige Icon-Buttons,
 * GitHub zuerst, E-Mail zuletzt (direkt ueber seinem Hinweistext).
 * Query-Params (u. a. `site_id`) werden an beide Ziele durchgereicht.
 */
export function renderSelectionPage(
  githubAuthUrl: string,
  emailUrl: string,
  siteId: string | undefined,
  t: Texts,
): Response {
  const body = `${eyebrow(t.eyebrow, siteId)}
<h1>${t.selection.title}</h1>
<a class="way way-secondary" href="${escapeHtmlAttribute(githubAuthUrl)}">${ICON_GITHUB}<span>${t.selection.github}</span></a>
<a class="way way-secondary" href="${escapeHtmlAttribute(emailUrl)}">${ICON_MAIL}<span>${t.selection.email}</span></a>
<p class="muted">${t.selection.hint}</p>`;

  return htmlResponse(page(t.lang, t.eyebrow, body));
}

interface CallbackSuccessPayload {
  provider: 'github';
  token: string;
}

/**
 * Decap/Sveltia-postMessage-Antwortseite (Erfolg). Bewusst OHNE
 * `refreshToken`-Feld (Research `sveltia-token-persistenz-2026-09-04`):
 * damit fuehrt ein abgelaufenes Kurzlebigkeits-Token sauber zu
 * 401 -> Logout -> Re-Login statt zu einem kaputten Silent-Refresh-Pfad.
 *
 * Handshake (Decap/Sveltia-Protokoll): Popup sendet `authorizing:github` an
 * den Opener, wartet auf dessen Antwort, prueft `event.source === window.opener`
 * und `event.origin` EXAKT gegen die erlaubten Origins (nur HTTPS, exakter Host,
 * Standard-Port) und sendet erst dann den Token an genau diesen Origin.
 */
export function renderCallbackSuccessPage(
  payload: CallbackSuccessPayload,
  allowedDomains: string[],
  t: Texts,
): Response {
  const script = `(function () {
  var provider = ${scriptJson(payload.provider)};
  var payload = ${scriptJson(payload)};
  var allowedOrigins = ${scriptJson(buildAllowedOrigins(allowedDomains))};

  if (!window.opener) { return; }

  function receiveMessage(event) {
    if (event.source !== window.opener) { return; }
    if (event.data !== ('authorizing:' + provider)) { return; }
    if (allowedOrigins.indexOf(event.origin) === -1) { return; }
    window.removeEventListener('message', receiveMessage, false);
    window.opener.postMessage(
      'authorization:' + provider + ':success:' + JSON.stringify(payload),
      event.origin,
    );
  }

  window.addEventListener('message', receiveMessage, false);
  window.opener.postMessage('authorizing:' + provider, '*');
})();`;

  const body = `${eyebrow(t.eyebrow)}
<h1>${t.callbackSuccess.title}</h1>
<p>${t.callbackSuccess.text}</p>
<script>${script}</script>`;

  return htmlResponse(page(t.lang, t.callbackSuccess.title, body));
}

/**
 * postMessage-Fehlerseite im Decap/Sveltia-Format
 * (`authorization:github:error:{...}`). Laesst das Popup nie haengen.
 */
export function renderCallbackErrorPage(
  message: string,
  allowedDomains: string[],
  t: Texts,
  status = 502,
): Response {
  const script = `(function () {
  var provider = 'github';
  var errorPayload = { provider: provider, error: ${scriptJson(message)} };
  var allowedOrigins = ${scriptJson(buildAllowedOrigins(allowedDomains))};

  if (!window.opener) { return; }

  function receiveMessage(event) {
    if (event.source !== window.opener) { return; }
    if (event.data !== ('authorizing:' + provider)) { return; }
    if (allowedOrigins.indexOf(event.origin) === -1) { return; }
    window.removeEventListener('message', receiveMessage, false);
    window.opener.postMessage(
      'authorization:' + provider + ':error:' + JSON.stringify(errorPayload),
      event.origin,
    );
  }

  window.addEventListener('message', receiveMessage, false);
  window.opener.postMessage('authorizing:' + provider, '*');
})();`;

  const body = `${eyebrow(t.eyebrow)}
<div class="error-block">
<h1>${t.callbackError.title}</h1>
<p>${escapeHtml(message)}</p>
</div>
<script>${script}</script>`;

  return htmlResponse(page(t.lang, t.callbackError.title, body), status);
}

/** Fehlerseite: AUD/Client-ID (noch) unbekannt — Verweis auf `/setup` statt
 * stiller Fehlkonfiguration (ADR 0014). */
export function renderSetupIncompletePage(t: Texts): Response {
  const body = `${eyebrow(t.eyebrow)}
<div class="error-block">
<h1>${t.setupIncomplete.title}</h1>
<p>${t.setupIncomplete.text}</p>
</div>
<p><a href="/setup">${t.setupIncomplete.linkLabel}</a></p>`;

  return htmlResponse(page(t.lang, t.setupIncomplete.title, body), 503);
}

const WIZARD_SCRIPT = `
function postSettings(payload, onError) {
  fetch('/setup/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
    .then(function (res) { return res.json().catch(function () { return { ok: false, reason: 'invalid_response' }; }); })
    .then(function (data) {
      if (data.ok) { location.reload(); return; }
      onError(data.reason || 'unknown');
    })
    .catch(function () { onError('network'); });
}
`;

/** Fortschrittsanzeige des Wizards (Design A): erledigte Schritte abgehakt,
 * der aktive fett, kommende neutral. */
function renderStepper(step: number, t: Texts): string {
  const items = t.wizard.stepLabels
    .map((label, index) => {
      const n = index + 1;
      const cls = n < step ? 'done' : n === step ? 'active' : '';
      const dot = n < step ? '✓' : String(n);

      return `<li class="${cls}"><span class="dot">${dot}</span> ${escapeHtml(label)}</li>`;
    })
    .join('');

  return `<ol class="steps">${items}</ol>`;
}

function wizardTopbar(email: string, t: Texts): string {
  return `<div class="topbar">
<span class="brand">${escapeHtml(t.dashboard.brand)} · ${escapeHtml(t.wizard.title)}</span>
<span class="who">${escapeHtml(t.dashboard.signedInAs(email))}</span>
</div>`;
}

function renderWizardStepCard(
  step: 1 | 2 | 3 | 4 | 5 | 6 | 7,
  config: LoadedConfig,
  presentedAud: string | undefined,
  baseUrl: string,
  t: Texts,
): string {
  const w = t.wizard;

  if (step === 1) {
    return `<div class="card">
<h2>${w.step1.title}</h2>
<p>${w.step1.intro}</p>
<p>${w.step1.audLabel} <code>${escapeHtml(presentedAud ?? '')}</code></p>
<div class="row">
<button class="btn btn-primary" id="step1save">${w.step1.confirm}</button>
</div>
</div>
<script>
document.getElementById('step1save').addEventListener('click', function () {
  postSettings({ accessAppAud: ${JSON.stringify(presentedAud ?? '')} }, function (reason) {
    alert(${JSON.stringify(w.errorPrefix)} + reason);
  });
});
</script>`;
  }

  if (step === 2) {
    return `<div class="card">
<h2>${w.step2.title}</h2>
<p>${w.step2.intro}</p>
<p class="muted">${w.step2.guide}</p>
<label class="field" for="cid">${w.step2.clientIdLabel}</label>
<input type="text" id="cid" value="${escapeHtmlAttribute(config.githubAppClientId ?? '')}">
<div class="row">
<button class="btn btn-primary" id="step2save">${w.step2.save}</button>
</div>
</div>
<script>
document.getElementById('step2save').addEventListener('click', function () {
  var clientId = document.getElementById('cid').value.trim();
  if (!clientId) { alert(${JSON.stringify(w.errorPrefix)} + 'invalid_client_id'); return; }
  postSettings({ githubAppClientId: clientId }, function (reason) {
    alert(${JSON.stringify(w.errorPrefix)} + reason);
  });
});
</script>`;
  }

  if (step === 3) {
    return `<div class="card">
<h2>${w.connect.title}</h2>
<p>${w.connect.intro}</p>
<div class="row">
<button class="btn btn-primary" id="connectstart">${w.connect.button}</button>
</div>
<div id="flow" hidden>
  <p>${t.setup.flowStep1} <strong id="code" style="font-size:1.5em"></strong></p>
  <p>2. <a id="verify" target="_blank" rel="noopener">github.com/login/device</a>
     ${t.setup.flowStep2}</p>
  <p id="status">${t.setup.flowWaiting}</p>
</div>
</div>
<script>
document.getElementById('connectstart').addEventListener('click', startWizardDeviceFlow);
function startWizardDeviceFlow() {
  var btn = document.getElementById('connectstart');
  btn.disabled = true;
  fetch('/setup/github/start', { method: 'POST' })
    .then(function (r) { return r.json(); })
    .then(function (started) {
      if (!started.ok) {
        document.getElementById('status').textContent = ${JSON.stringify(t.setup.startFailed)} + started.reason;
        document.getElementById('flow').hidden = false;
        btn.disabled = false;
        return;
      }
      document.getElementById('code').textContent = started.userCode;
      document.getElementById('verify').href = started.verificationUri;
      document.getElementById('flow').hidden = false;
      var interval = (started.interval || 5) * 1000;
      var poll = function () {
        fetch('/setup/github/poll', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ deviceCode: started.deviceCode }),
        }).then(function (r) { return r.json(); }).then(function (res) {
          if (res.ok) {
            document.getElementById('status').textContent = ${JSON.stringify(t.setup.connected)};
            location.reload();
            return;
          }
          if (res.reason === 'slow_down') { interval += 5000; }
          if (res.reason === 'pending' || res.reason === 'slow_down') { setTimeout(poll, interval); return; }
          document.getElementById('status').textContent = ${JSON.stringify(t.setup.failed)} + res.reason;
          btn.disabled = false;
        });
      };
      setTimeout(poll, interval);
    });
}
</script>`;
  }

  if (step === 4) { // Inhalt: w.step3 (Website freischalten)
    return `<div class="card">
<h2>${w.step3.title}</h2>
<p>${w.step3.intro}</p>
<label class="field">${w.step3.domainsLabel}</label>
<div id="domainlist">
  <div class="row domainrow" style="margin-top:0">
    <input type="text" class="domain" placeholder="${escapeHtmlAttribute(w.step3.domainsPlaceholder)}">
  </div>
</div>
<div class="row">
<button class="btn" type="button" id="adddomain">＋ ${w.step3.addDomain}</button>
</div>
<div class="row">
<button class="btn btn-primary" id="step3save">${w.step3.save}</button>
</div>
</div>
<script>
function addDomainRow(value) {
  var row = document.createElement('div');
  row.className = 'row domainrow';
  row.style.marginTop = '8px';
  var input = document.createElement('input');
  input.type = 'text'; input.className = 'domain'; input.value = value || '';
  var del = document.createElement('button');
  del.type = 'button'; del.className = 'btn btn-ghost'; del.textContent = '✕';
  del.setAttribute('aria-label', ${JSON.stringify(w.step3.removeDomain)});
  del.title = ${JSON.stringify(w.step3.removeDomain)};
  del.addEventListener('click', function () { row.remove(); });
  row.appendChild(input); row.appendChild(del);
  document.getElementById('domainlist').appendChild(row);
}
document.getElementById('adddomain').addEventListener('click', function () { addDomainRow(''); });
document.getElementById('step3save').addEventListener('click', function () {
  var domains = Array.prototype.map.call(document.querySelectorAll('#domainlist .domain'), function (el) {
    return el.value.trim();
  }).filter(function (v) { return v !== ''; }).join(',');
  postSettings({ allowedDomains: domains }, function (reason) {
    var msg = reason === 'invalid_domain' ? ${JSON.stringify(w.step3.invalidDomain)}
      : reason === 'empty_domains' ? ${JSON.stringify(w.step3.emptyDomains)}
      : ${JSON.stringify(w.errorPrefix)} + reason;
    alert(msg);
  });
});
</script>`;
  }

  if (step === 5) { // Inhalt: w.step4 (GitHub-Login, optional)
    return `<div class="card">
<h2>${w.step4.title}</h2>
<p>${w.step4.intro}</p>
<label class="field" for="authUrl">${w.step4.urlLabel}</label>
<input type="text" id="authUrl" placeholder="${escapeHtmlAttribute(w.step4.placeholder)}">
<div class="row">
<button class="btn btn-primary" id="step4save">${w.step4.save}</button>
<button class="btn btn-ghost" id="step4skip">${w.step4.skip}</button>
</div>
</div>
<script>
document.getElementById('step4save').addEventListener('click', function () {
  var url = document.getElementById('authUrl').value.trim();
  postSettings({ githubAuthUrl: url }, function (reason) {
    alert(reason === 'invalid_url' ? ${JSON.stringify(w.step4.invalidUrl)} : ${JSON.stringify(w.errorPrefix)} + reason);
  });
});
document.getElementById('step4skip').addEventListener('click', function () {
  postSettings({ skipGithubAuthUrl: true }, function (reason) {
    alert(${JSON.stringify(w.errorPrefix)} + reason);
  });
});
</script>`;
  }

  if (step === 6) { // Inhalt: w.step5 (Redakteure-Link, optional)
    return `<div class="card">
<h2>${w.step5.title}</h2>
<p>${w.step5.intro}</p>
<label class="field" for="manageUrl">${w.step5.urlLabel}</label>
<input type="text" id="manageUrl" placeholder="${escapeHtmlAttribute(w.step5.placeholder)}">
<div class="row">
<button class="btn btn-primary" id="step5save">${w.step5.save}</button>
<button class="btn btn-ghost" id="step5skip">${w.step5.skip}</button>
</div>
</div>
<script>
document.getElementById('step5save').addEventListener('click', function () {
  var url = document.getElementById('manageUrl').value.trim();
  postSettings({ manageEditorsUrl: url }, function (reason) {
    alert(reason === 'invalid_url' ? ${JSON.stringify(w.step5.invalidUrl)} : ${JSON.stringify(w.errorPrefix)} + reason);
  });
});
document.getElementById('step5skip').addEventListener('click', function () {
  postSettings({ skipManageEditorsUrl: true }, function (reason) {
    alert(${JSON.stringify(w.errorPrefix)} + reason);
  });
});
</script>`;
  }

  const configYml = `backend:
  name: github
  repo: <IHR-REPO>
  base_url: ${baseUrl}
  auth_methods: [oauth]`;

  return `<div class="card">
<h2>${w.step6.title}</h2>
<p>${w.step6.summary}</p>
<p class="muted">${w.step6.configYmlHint}</p>
<pre class="codeblock"><code>${escapeHtml(configYml)}</code></pre>
<div class="row">
<button class="btn" type="button" id="copycfg">${w.step6.copyConfig}</button>
</div>
<div class="row">
<button class="btn btn-primary" id="finishwizard">${w.step6.goToDashboard}</button>
</div>
</div>
<script>
document.getElementById('copycfg').addEventListener('click', function () {
  var btn = document.getElementById('copycfg');
  navigator.clipboard.writeText(${JSON.stringify("")} + document.querySelector('.codeblock code').textContent).then(function () {
    var old = btn.textContent; btn.textContent = ${JSON.stringify(w.step6.copied)};
    setTimeout(function () { btn.textContent = old; }, 1500);
  });
});
</script>
<script>
document.getElementById('finishwizard').addEventListener('click', function () {
  postSettings({ finishWizard: true }, function (reason) {
    alert(${JSON.stringify(w.errorPrefix)} + reason);
  });
});
</script>`;
}

/**
 * Setup-Wizard (ADR 0014): sieben Schritte (Client-ID-Speichern und
 * Bot-Verbinden sind getrennte Schritte, User-Feedback 2026-09-04), Zustand
 * aus den Settings abgeleitet. Jeder Schritt-Save loest `location.reload()`
 * aus — der naechste `GET /setup` zeigt serverseitig den naechsten Schritt
 * (oder, sobald die Pflichtschritte erledigt sind, direkt die Verwaltung).
 */
export function renderWizardPage(
  step: 1 | 2 | 3 | 4 | 5 | 6 | 7,
  config: LoadedConfig,
  email: string,
  presentedAud: string | undefined,
  baseUrl: string,
  t: Texts,
): Response {
  const body = `${wizardTopbar(email, t)}
<div class="admin-inner">
${renderStepper(step, t)}
${renderWizardStepCard(step, config, presentedAud, baseUrl, t)}
</div>
<script>${WIZARD_SCRIPT}</script>`;

  return adminHtmlResponse(adminPage(t.lang, t.wizard.title, body));
}

function settingsRow(
  label: string,
  value: string | undefined,
  notSetLabel: string,
  fieldName: string,
  editTitle: string,
  formHtml: string,
): string {
  const display = value !== undefined && value !== '' ? `<code>${escapeHtml(value)}</code>` : `<span class="muted">${escapeHtml(notSetLabel)}</span>`;

  return `<span class="k">${escapeHtml(label)}</span>
<span class="v">${display}<button class="editlink" type="button" data-field="${fieldName}" title="${escapeHtmlAttribute(editTitle)}" aria-label="${escapeHtmlAttribute(editTitle)}">${ICON_PENCIL}</button></span>
${formHtml}`;
}

/** Pro-Wert-Formular (Design-Amendment 2026-09-04): Freitext-Eingabe, wird
 * ueber das Stift-Icon inline ein-/ausgeblendet. */
function textEditForm(
  fieldName: string,
  currentValue: string,
  placeholder: string,
  saveLabel: string,
  cancelLabel: string,
): string {
  return `<form class="editform" data-field="${fieldName}" hidden>
<input type="text" name="value" value="${escapeHtmlAttribute(currentValue)}" placeholder="${escapeHtmlAttribute(placeholder)}">
<div class="row">
<button class="btn btn-primary" type="submit">${saveLabel}</button>
<button class="btn btn-ghost" type="button" data-cancel="1">${cancelLabel}</button>
</div>
</form>`;
}

/** Sonderfall `accessAppAud` ("AUD neu festlegen", ADR 0014): KEIN Freitext —
 * das Formular zeigt ausschliesslich das gerade vom Access-JWT praesentierte
 * `aud` und submitted exakt diesen Wert zur Bestaetigung. */
function audResetForm(presentedAud: string | undefined, d: Texts['dashboard']): string {
  return `<form class="editform" data-field="accessAppAud" hidden>
<p class="muted">${d.audResetIntro}</p>
<p><code>${escapeHtml(presentedAud ?? '')}</code></p>
<input type="hidden" name="value" value="${escapeHtmlAttribute(presentedAud ?? '')}">
<div class="row">
<button class="btn btn-primary" type="submit">${d.audResetConfirm}</button>
<button class="btn btn-ghost" type="button" data-cancel="1">${d.cancelButton}</button>
</div>
</form>`;
}

/**
 * Verwaltungs-Dashboard (Design B): einklappbare Sidebar (Zustand in
 * localStorage), drei serverseitig gerenderte Sektionen, clientseitiges
 * Umschalten. Einstellungen ueber Stift-Icons direkt hinter dem Wert
 * (Design-Amendment 2026-09-04) statt rechtsbuendiger Spalte.
 */
export function renderDashboardPage(
  config: LoadedConfig,
  status: TokenStoreStatus,
  users: UserRecord[],
  events: AuditEvent[],
  email: string,
  presentedAud: string | undefined,
  t: Texts,
): Response {
  const d = t.dashboard;

  const manageBtn = config.manageEditorsUrl
    ? `<a class="btn btn-primary" href="${escapeHtmlAttribute(config.manageEditorsUrl)}" target="_blank" rel="noopener">${ICON_USERS}<span>${t.setup.manageButton}</span></a>`
    : `<p class="muted">${t.setup.manageFallback}</p>`;

  const userRows = users
    .map(
      (u) => `<tr>
<td data-sort="${escapeHtmlAttribute(u.email)}">${escapeHtml(u.email)}</td>
<td data-sort="${u.firstSeen}"><span class="localtime" data-iso="${new Date(u.firstSeen).toISOString()}">—</span></td>
<td data-sort="${u.lastSeen}"><span class="localtime" data-iso="${new Date(u.lastSeen).toISOString()}">—</span></td>
<td class="usercell-action"><button class="editlink danger" type="button" data-deluser="${escapeHtmlAttribute(u.email)}" title="${escapeHtmlAttribute(d.userDelete)}" aria-label="${escapeHtmlAttribute(d.userDelete)}">${ICON_TRASH}</button></td>
</tr>`,
    )
    .join('');

  const userTable = users.length === 0
    ? `<p class="muted">${d.usersEmpty}</p>`
    : `<div class="tablewrap"><table class="usertable" id="usertable">
<thead><tr>
<th><button type="button" class="sortbtn" data-col="0" data-type="text">${d.userColEmail} <span class="sortarrow"><span class="up">\u25B2</span><span class="down">\u25BC</span></span></button></th>
<th><button type="button" class="sortbtn" data-col="1" data-type="num">${d.userColFirst} <span class="sortarrow"><span class="up">\u25B2</span><span class="down">\u25BC</span></span></button></th>
<th><button type="button" class="sortbtn" data-col="2" data-type="num">${d.userColLast} <span class="sortarrow"><span class="up">\u25B2</span><span class="down">\u25BC</span></span></button></th>
<th aria-label="${escapeHtmlAttribute(d.userDelete)}"></th>
</tr></thead>
<tbody>${userRows}</tbody>
</table></div>
<div class="row">
<button class="btn btn-danger" id="clearUsersBtn" title="${escapeHtmlAttribute(d.usersClearHint)}">${d.usersClear}</button>
</div>`;

  const usersSection = `<div class="card full">
<h2>${d.usersTitle}</h2>
<p>${d.usersText}</p>
${manageBtn}
<h3 class="subhead">${d.usersHistoryTitle}</h3>
${userTable}
</div>`;

  const eventLabels: Record<string, string> = {
    settings_updated: d.eventSettingsUpdated,
    bot_connected: d.eventBotConnected,
    bot_disconnected: d.eventBotDisconnected,
    token_rotated: d.eventTokenRotated,
    token_rotate_failed: d.eventTokenRotateFailed,
    login_disabled: d.eventLoginDisabled,
    login_enabled: d.eventLoginEnabled,
  };

  const eventRows = events
    .map((e) => {
      const label = eventLabels[e.type] ?? e.type;
      const detail = e.detail ? ` <span class="muted">(${escapeHtml(e.detail)})</span>` : '';

      return `<tr>
<td><span class="localtime" data-iso="${new Date(e.at).toISOString()}">—</span></td>
<td>${escapeHtml(e.actor)}</td>
<td>${escapeHtml(label)}${detail}</td>
</tr>`;
    })
    .join('');

  const eventsTable = events.length === 0
    ? `<p class="muted">${d.auditEmpty}</p>`
    : `<div class="tablewrap"><table class="usertable">
<thead><tr><th>${d.auditColTime}</th><th>${d.auditColActor}</th><th>${d.auditColType}</th></tr></thead>
<tbody>${eventRows}</tbody>
</table></div>`;

  const auditSection = `<div class="card full">
<h2>${d.auditTitle}</h2>
<p>${d.auditText}</p>
${eventsTable}
<p class="muted" style="margin-top:12px">${d.auditRetentionNote}</p>
</div>`;

  const badge = status.authorized
    ? `<span class="badge ok">${d.connectedBadge}</span>`
    : `<span class="badge">${d.notConnectedBadge}</span>`;

  const loginDisabled = config.loginDisabled;
  const loginBadge = loginDisabled
    ? `<span class="badge btn-danger">${d.loginDisabledBadge}</span>`
    : `<span class="badge ok">${d.loginActiveBadge}</span>`;
  const loginToggleRow = `<span class="k">${d.loginToggleLabel}</span><span class="v">${loginBadge}
<button class="btn ${loginDisabled ? '' : 'btn-danger'}" id="loginToggleBtn" data-disabled="${loginDisabled ? '1' : '0'}" style="margin-left:8px">${loginDisabled ? d.loginEnableButton : d.loginDisableButton}</button>
<span class="muted" style="display:block;margin-top:6px">${d.loginToggleHint}</span>
</span>`;

  // Naechste Cron-Rotation (0/6/12/18 UTC) serverseitig als ISO bestimmen;
  // die Umrechnung in die Nutzer-Zeitzone macht der Client (localizeTimes()).
  const nextRotationIso = ((): string => {
    const now = new Date();
    const next = new Date(now);
    next.setUTCMinutes(0, 0, 0);
    const slots = [0, 6, 12, 18];
    const hour = slots.find((h) => h > now.getUTCHours());
    if (hour === undefined) {
      next.setUTCDate(next.getUTCDate() + 1);
      next.setUTCHours(0);
    } else {
      next.setUTCHours(hour);
    }
    return next.toISOString();
  })();

  const tokenRow = status.authorized && status.accessToken
    ? `<span class="k">${d.tokenLabel}</span><span class="v">
<code id="tokenval" data-token="${escapeHtmlAttribute(status.accessToken)}">${'•'.repeat(24)}</code>
<button class="editlink" type="button" id="tokentoggle" title="${escapeHtmlAttribute(d.tokenShow)}" aria-label="${escapeHtmlAttribute(d.tokenShow)}" aria-pressed="false">${ICON_EYE}</button>
</span>
<span class="k">${d.tokenValidLabel}</span><span class="v"><span class="localtime" data-iso="${status.expiresAt ? new Date(status.expiresAt).toISOString() : ''}">—</span></span>
<span class="k">${d.nextRotationLabel}</span><span class="v"><span class="localtime" data-iso="${nextRotationIso}">—</span></span>`
    : '';

  const accountRow = status.account
    ? `<span class="k">${d.accountLabel}</span><span class="v"><code>${escapeHtml(status.account.login)}</code> <span class="muted">· ${escapeHtml(d.installationsLabel(status.account.installations))}</span></span>`
    : '';

  const githubSection = `<div class="card full">
<h2>${d.githubTitle}</h2>
<div class="kv">
<span class="k">${d.statusLabel}</span><span>${badge}</span>
${accountRow}
${tokenRow}
${settingsRow(
  d.fieldGithubAppClientId,
  config.githubAppClientId,
  d.notSet,
  'githubAppClientId',
  d.editTitle,
  textEditForm('githubAppClientId', config.githubAppClientId ?? '', '', d.saveButton, d.cancelButton),
)}
</div>
<div class="row">
<button class="btn" id="rotateBtn">${t.setup.rotateButton}</button>
<button class="btn" id="reconnectBtn">${d.reconnectButton}</button>
<button class="btn btn-danger" id="disconnectBtn" title="${escapeHtmlAttribute(d.disconnectHint)}">${d.disconnectButton}</button>
</div>
<p id="rotateStatus" class="muted"></p>
<div id="flow" hidden>
  <p>${t.setup.flowStep1} <strong id="code" style="font-size:1.5em"></strong></p>
  <p>2. <a id="verify" target="_blank" rel="noopener">github.com/login/device</a>
     ${t.setup.flowStep2}</p>
  <p id="status">${t.setup.flowWaiting}</p>
</div>
</div>`;

  const settingsSection = `<div class="card full">
<h2>${d.settingsTitle}</h2>
<div class="kv">
${loginToggleRow}
${settingsRow(
  d.fieldAccessAppAud,
  config.accessAppAud,
  d.notSet,
  'accessAppAud',
  d.editTitle,
  audResetForm(presentedAud, d),
)}
${settingsRow(
  d.fieldAllowedDomains,
  config.allowedDomains.join(', ') || undefined,
  d.notSet,
  'allowedDomains',
  d.editTitle,
  textEditForm('allowedDomains', config.allowedDomains.join(', '), d.domainsPlaceholder, d.saveButton, d.cancelButton),
)}
${settingsRow(
  d.fieldGithubAuthUrl,
  config.githubAuthUrl,
  d.notSet,
  'githubAuthUrl',
  d.editTitle,
  textEditForm('githubAuthUrl', config.githubAuthUrl ?? '', d.urlPlaceholder, d.saveButton, d.cancelButton),
)}
${settingsRow(
  d.fieldManageEditorsUrl,
  config.manageEditorsUrl,
  d.notSet,
  'manageEditorsUrl',
  d.editTitle,
  textEditForm('manageEditorsUrl', config.manageEditorsUrl ?? '', d.urlPlaceholder, d.saveButton, d.cancelButton),
)}
</div>
<p class="muted" style="margin-top:16px">${d.settingsFootnote}</p>
</div>`;

  const body = `<div class="topbar">
<span class="brand">${escapeHtml(d.brand)}</span>
<span class="who">${escapeHtml(d.signedInAs(email))}</span>
</div>
<div class="shell" id="shell">
<nav class="side" aria-label="${escapeHtmlAttribute(d.navSettings)}">
<div class="navlist">
<button class="navbtn active" data-section="users">${ICON_USERS}<span>${d.navUsers}</span></button>
<button class="navbtn" data-section="github">${ICON_GITHUB}<span>${d.navGithub}</span></button>
<button class="navbtn" data-section="settings">${ICON_GEAR}<span>${d.navSettings}</span></button>
<button class="navbtn" data-section="audit">${ICON_AUDIT}<span>${d.navAudit}</span></button>
</div>
<button class="navbtn navtoggle" id="navtoggle" title="${escapeHtmlAttribute(d.toggleMenuTitle)}" aria-label="${escapeHtmlAttribute(d.toggleMenuTitle)}">${ICON_CHEVRON}<span>${d.collapseLabel}</span></button>
</nav>
<div class="content">
<div class="section active" data-section="users">${usersSection}</div>
<div class="section" data-section="github">${githubSection}</div>
<div class="section" data-section="settings">${settingsSection}</div>
<div class="section" data-section="audit">${auditSection}</div>
</div>
</div>
<script>${WIZARD_SCRIPT}
(function () {
  var shell = document.getElementById('shell');
  var navtoggle = document.getElementById('navtoggle');
  var navButtons = document.querySelectorAll('.navbtn[data-section]');
  var sections = document.querySelectorAll('.section');

  if (localStorage.getItem('sidebarCollapsed') === '1') { shell.classList.add('collapsed'); }
  navtoggle.addEventListener('click', function () {
    shell.classList.toggle('collapsed');
    localStorage.setItem('sidebarCollapsed', shell.classList.contains('collapsed') ? '1' : '0');
  });

  navButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      navButtons.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      var target = btn.dataset.section;
      sections.forEach(function (s) {
        s.classList.toggle('active', s.dataset.section === target);
      });
    });
  });

  document.querySelectorAll('.editlink').forEach(function (link) {
    link.addEventListener('click', function () {
      var form = link.closest('.v').parentNode.querySelector('form.editform[data-field="' + link.dataset.field + '"]');
      if (form) { form.hidden = !form.hidden; }
    });
  });

  document.querySelectorAll('form.editform').forEach(function (form) {
    var cancelBtn = form.querySelector('[data-cancel]');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () { form.hidden = true; });
    }
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var field = form.dataset.field;
      var input = form.querySelector('[name=value]');
      var payload = {};
      payload[field] = input.value;
      postSettings(payload, function (reason) { alert(${JSON.stringify(t.wizard.errorPrefix)} + reason); });
    });
  });

  var rotateBtn = document.getElementById('rotateBtn');
  if (rotateBtn) {
    rotateBtn.addEventListener('click', function () {
      fetch('/setup/github/rotate', { method: 'POST' }).then(function (r) { return r.json(); }).then(function (res) {
        document.getElementById('rotateStatus').textContent = res.ok ? ${JSON.stringify(t.setup.rotateOk)} : ${JSON.stringify(t.setup.rotateFail)} + res.reason;
      });
    });
  }

  var tokentoggle = document.getElementById('tokentoggle');
  if (tokentoggle) {
    tokentoggle.addEventListener('click', function () {
      var el = document.getElementById('tokenval');
      var shown = tokentoggle.getAttribute('aria-pressed') === 'true';
      if (shown) {
        el.textContent = ${JSON.stringify('•'.repeat(24))};
        tokentoggle.innerHTML = ${JSON.stringify(ICON_EYE)};
        tokentoggle.setAttribute('aria-pressed', 'false');
        tokentoggle.title = ${JSON.stringify(d.tokenShow)};
        tokentoggle.setAttribute('aria-label', ${JSON.stringify(d.tokenShow)});
      } else {
        el.textContent = el.getAttribute('data-token');
        tokentoggle.innerHTML = ${JSON.stringify(ICON_EYE_OFF)};
        tokentoggle.setAttribute('aria-pressed', 'true');
        tokentoggle.title = ${JSON.stringify(d.tokenHide)};
        tokentoggle.setAttribute('aria-label', ${JSON.stringify(d.tokenHide)});
      }
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll('.localtime'), function (el) {
    var iso = el.getAttribute('data-iso');
    if (!iso) { return; }
    try { el.textContent = new Date(iso).toLocaleString(); } catch (e) {}
  });
  var clearUsersBtn = document.getElementById('clearUsersBtn');
  if (clearUsersBtn) {
    clearUsersBtn.addEventListener('click', function () {
      if (!window.confirm(${JSON.stringify(d.usersClearConfirm)})) { return; }
      clearUsersBtn.disabled = true;
      fetch('/setup/users/clear', { method: 'POST' })
        .then(function (r) { return r.json(); })
        .then(function () { location.reload(); });
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-deluser]'), function (btn) {
    btn.addEventListener('click', function () {
      var email = btn.getAttribute('data-deluser');
      if (!window.confirm(${JSON.stringify(d.userDeleteConfirm)}.replace('%s', email))) { return; }
      btn.disabled = true;
      fetch('/setup/users/delete', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email }),
      }).then(function (r) { return r.json(); }).then(function () { location.reload(); });
    });
  });
  var usertable = document.getElementById('usertable');
  if (usertable) {
    var sortState = { col: -1, dir: 1 };
    Array.prototype.forEach.call(usertable.querySelectorAll('.sortbtn'), function (btn) {
      btn.addEventListener('click', function () {
        var col = parseInt(btn.getAttribute('data-col'), 10);
        var type = btn.getAttribute('data-type');
        sortState.dir = sortState.col === col ? -sortState.dir : 1;
        sortState.col = col;
        var tbody = usertable.querySelector('tbody');
        var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
        rows.sort(function (a, b) {
          var av = a.children[col].getAttribute('data-sort');
          var bv = b.children[col].getAttribute('data-sort');
          var cmp = type === 'num' ? (Number(av) - Number(bv)) : String(av).localeCompare(String(bv));
          return cmp * sortState.dir;
        });
        rows.forEach(function (r) { tbody.appendChild(r); });
        Array.prototype.forEach.call(usertable.querySelectorAll('.sortarrow .up, .sortarrow .down'), function (s) {
          s.classList.remove('active');
        });
        btn.querySelector(sortState.dir === 1 ? '.sortarrow .up' : '.sortarrow .down').classList.add('active');
      });
    });
  }
  var disconnectBtn = document.getElementById('disconnectBtn');
  if (disconnectBtn) {
    disconnectBtn.addEventListener('click', function () {
      disconnectBtn.disabled = true;
      fetch('/setup/github/disconnect', { method: 'POST' })
        .then(function (r) { return r.json(); })
        .then(function () { location.reload(); });
    });
  }
  var loginToggleBtn = document.getElementById('loginToggleBtn');
  if (loginToggleBtn) {
    loginToggleBtn.addEventListener('click', function () {
      var currentlyDisabled = loginToggleBtn.getAttribute('data-disabled') === '1';
      // Nur beim Deaktivieren rueckfragen; Wiederaktivieren ist unkritisch.
      if (!currentlyDisabled && !window.confirm(${JSON.stringify(d.loginDisableConfirm)})) { return; }
      loginToggleBtn.disabled = true;
      fetch('/setup/login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ disabled: !currentlyDisabled }),
      }).then(function (r) { return r.json(); }).then(function () { location.reload(); });
    });
  }
  var reconnectBtn = document.getElementById('reconnectBtn');
  if (reconnectBtn) {
    reconnectBtn.addEventListener('click', function () {
      reconnectBtn.disabled = true;
      fetch('/setup/github/start', { method: 'POST' }).then(function (r) { return r.json(); }).then(function (started) {
        if (!started.ok) {
          document.getElementById('status').textContent = ${JSON.stringify(t.setup.startFailed)} + started.reason;
          document.getElementById('flow').hidden = false;
          return;
        }
        document.getElementById('code').textContent = started.userCode;
        document.getElementById('verify').href = started.verificationUri;
        document.getElementById('flow').hidden = false;
        var interval = (started.interval || 5) * 1000;
        var poll = function () {
          fetch('/setup/github/poll', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ deviceCode: started.deviceCode }),
          }).then(function (r) { return r.json(); }).then(function (res) {
            if (res.ok) { document.getElementById('status').textContent = ${JSON.stringify(t.setup.connected)}; return; }
            if (res.reason === 'slow_down') { interval += 5000; }
            if (res.reason === 'pending' || res.reason === 'slow_down') { setTimeout(poll, interval); return; }
            document.getElementById('status').textContent = ${JSON.stringify(t.setup.failed)} + res.reason;
          });
        };
        setTimeout(poll, interval);
      });
    });
  }
})();
</script>`;

  return adminHtmlResponse(adminPage(t.lang, d.brand, body));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', '&quot;');
}

/**
 * JSON zum Einbetten in einen `<script>`-Block: neutralisiert `<`, damit ein
 * Wert wie `</script>` den Block nicht schliessen kann. (Reguläre Werte —
 * Tokens, validierte Origins — enthalten kein `<`; das ist Defense-in-Depth.)
 */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}
