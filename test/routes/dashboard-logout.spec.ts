import { describe, expect, it } from 'vitest';
import { renderDashboardPage } from '../../src/pages.js';
import { pickTexts } from '../../src/texts.js';
import type { LoadedConfig } from '../../src/config.js';

const config: LoadedConfig = {
  ok: true,
  accessTeamDomain: 'team.cloudflareaccess.com',
  setupAdmins: ['admin@example.com'],
  accessAppAud: 'aud-value',
  githubAppClientId: 'Iv1.testclientid',
  allowedDomains: ['cms.example.com'],
  githubAuthUrl: undefined,
  manageUsersUrl: undefined,
  githubAuthUrlSkipped: true,
  manageUsersUrlSkipped: true,
  loginDisabled: false,
  setupComplete: true,
};

const status = { authorized: true, expiresAt: Date.now() + 3_600_000, accessToken: 'ghu_bot_token', account: null };

async function render(lang: string): Promise<string> {
  const t = pickTexts(lang);
  const response = renderDashboardPage(config, status, [], [], 'admin@example.com', 'aud-value', t);

  return response.text();
}

describe('dashboard account menu / logout', () => {
  it('offers a Cloudflare Access logout link under the signed-in email', async () => {
    const html = await render('en');

    expect(html).toContain('/cdn-cgi/access/logout');
    expect(html).toContain('admin@example.com');
    // The logout lives in an account dropdown toggled from the email.
    expect(html).toContain('id="usermenu"');
  });

  it('labels the logout action in German', async () => {
    const html = await render('de');

    expect(html).toContain('/cdn-cgi/access/logout');
    expect(html).toContain('Abmelden');
  });
});
