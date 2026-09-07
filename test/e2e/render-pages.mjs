import { Buffer } from 'node:buffer';
import { build } from 'esbuild';

/**
 * Bündelt die echten Render-Funktionen aus `src/pages.ts` (+ `pickTexts`) in ein
 * importierbares ESM-Modul (esbuild löst die `.js`→`.ts`-Specifiers auf; `src`
 * importiert `token-store` nur als Typ, also kein `cloudflare:workers` im Bundle)
 * und rendert jede vom Worker ausgelieferte Seite in beiden Sprachen zu HTML.
 * Der Playwright-Guard lädt dieses HTML in echtem Chromium und prüft, dass das
 * Client-JS ohne Fehler lädt/läuft.
 */
async function loadPagesModule() {
  const result = await build({
    stdin: {
      contents: "export * from './src/pages.ts';\nexport { pickTexts } from './src/texts.ts';",
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
  });

  const code = result.outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}

export async function renderAllPages() {
  const p = await loadPagesModule();
  const now = 1_800_000_000_000; // fester Zeitstempel (deterministisch)

  const config = {
    ok: true,
    accessTeamDomain: 'team.cloudflareaccess.com',
    setupAdmins: ['admin@example.com'],
    accessAppAud: 'aud-value',
    githubAppClientId: 'Iv1.testclientid',
    allowedDomains: ['cms.example.com'],
    githubAuthUrl: 'https://sveltia-cms-auth.example.net',
    manageEditorsUrl: 'https://dash.example.com/policy',
    githubAuthUrlSkipped: false,
    manageEditorsUrlSkipped: false,
    loginDisabled: false,
    setupComplete: true,
  };
  const status = {
    authorized: true,
    expiresAt: now + 3_600_000,
    accessToken: 'ghu_bot_token',
    account: { login: 'myclub-cms-bot', accountId: 4242, installations: 1 },
  };
  // Altbestand OHNE gespeicherte `accountId` (vor dem Konto-Pin verbunden,
  // Reaudit R5, auth-p6d2c) — deckt den Verifier-Fund aus Iteration 1 ab:
  // die Dashboard-Anzeige muss dies als "unbekannt" zeigen, nicht als
  // "undefined". `account` ist absichtlich untypisiert (kein `accountId`).
  const statusLegacyAccount = {
    ...status,
    account: { login: 'legacy-cms-bot', installations: 3 },
  };
  const users = [{ email: 'redakteurin@example.com', firstSeen: now - 100_000, lastSeen: now }];
  const events = [
    { type: 'settings_updated', actor: 'admin@example.com', at: now - 200_000, detail: 'allowedDomains' },
    { type: 'bot_connected', actor: 'admin@example.com', at: now - 100_000 },
    { type: 'token_rotated', actor: 'admin@example.com', at: now },
  ];
  const missing = { ok: false, reason: 'missing_required', missingKeys: ['ACCESS_TEAM_DOMAIN'] };

  const rendered = [];

  for (const lang of ['en', 'de']) {
    const t = p.pickTexts(lang);
    const add = (name, response) => rendered.push({ name: `${name} [${lang}]`, response });

    for (let step = 1; step <= 7; step += 1) {
      add(`wizard-step-${step}`, p.renderWizardPage(step, config, 'admin@example.com', 'aud-value', 'https://worker.example.com', t));
    }
    add('dashboard', p.renderDashboardPage(config, status, users, events, 'admin@example.com', 'aud-value', t));
    add('dashboard-legacy-account', p.renderDashboardPage(config, statusLegacyAccount, users, events, 'admin@example.com', 'aud-value', t));
    add('callback-success', p.renderCallbackSuccessPage({ provider: 'github', token: 'ghu_bot_token' }, ['cms.example.com'], t));
    add('callback-error', p.renderCallbackErrorPage('Beispiel-Fehler', ['cms.example.com'], t));
    add('selection', p.renderSelectionPage('https://worker.example.com/auth/github?site_id=cms.example.com', 'https://worker.example.com/auth/access?site_id=cms.example.com', 'cms.example.com', t));
    add('setup-connect', p.renderSetupPage(true, now + 3_600_000, 'https://dash.example.com/policy', t));
    add('missing-config', p.renderMissingConfigPage(missing, t));
    add('no-allowed-domains', p.renderNoAllowedDomainsPage(t));
    add('unsupported-domain', p.renderUnsupportedDomainPage(t));
    add('access-unauthorized', p.renderAccessUnauthorizedPage(t));
    add('setup-incomplete', p.renderSetupIncompletePage(t));
  }

  const pages = [];
  for (const { name, response } of rendered) {
    pages.push({ name, html: await response.text() });
  }
  return pages;
}
