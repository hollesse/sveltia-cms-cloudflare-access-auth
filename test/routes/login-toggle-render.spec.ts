import { describe, expect, it } from 'vitest';
import { renderDashboardPage } from '../../src/pages.js';
import { pickTexts } from '../../src/texts.js';
import type { LoadedConfig } from '../../src/config.js';

function baseConfig(loginDisabled: boolean): LoadedConfig {
  return {
    ok: true,
    accessTeamDomain: 'team.cloudflareaccess.com',
    setupAdmins: ['admin@example.com'],
    accessAppAud: 'aud-value',
    githubAppClientId: 'Iv1.testclientid',
    allowedDomains: ['cms.example.com'],
    githubAuthUrl: undefined,
    manageEditorsUrl: undefined,
    githubAuthUrlSkipped: true,
    manageEditorsUrlSkipped: true,
    loginDisabled,
    setupComplete: true,
  };
}

const status = { authorized: true, expiresAt: Date.now() + 3_600_000, accessToken: 'ghu_bot_token', account: null };

function render(loginDisabled: boolean): Promise<string> {
  const t = pickTexts('en');
  return renderDashboardPage(baseConfig(loginDisabled), status, [], [], 'admin@example.com', 'aud-value', t).text();
}

describe('editor login toggle switch', () => {
  it('renders a checkbox switch that is CHECKED while login is active', async () => {
    const html = await render(false);

    expect(html).toContain('id="loginToggle"');
    expect(html).toContain('type="checkbox"');
    // The switch reflects the active state: checked = editors can sign in.
    const input = html.slice(html.indexOf('id="loginToggle"') - 200, html.indexOf('id="loginToggle"') + 200);
    expect(input).toContain('checked');
  });

  it('renders the switch UNCHECKED while login is disabled', async () => {
    const html = await render(true);

    const input = html.slice(html.indexOf('id="loginToggle"') - 200, html.indexOf('id="loginToggle"') + 200);
    expect(input).not.toContain('checked');
  });

  it('labels the control "CMS Login" and never says "Redakteur"', async () => {
    const t = pickTexts('de');
    const html = await renderDashboardPage(baseConfig(false), status, [], [], 'admin@example.com', 'aud-value', t).text();

    expect(await html).toContain('CMS Login');
    expect(await html).not.toContain('Redakteur');
  });

  it('puts the explanatory hint into a tooltip behind an info icon, not inline', async () => {
    const html = await render(false);

    expect(html).toContain('class="infotip"');
    // The hint text lives inside the tooltip bubble.
    expect(html).toContain('infotip-bubble');
  });
});
