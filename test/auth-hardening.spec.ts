import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { importPKCS8, SignJWT } from 'jose';
import { validateAccessJwt } from '../src/access-jwt.js';
import { renderWizardPage } from '../src/pages.js';
import { pickTexts } from '../src/texts.js';
import type { LoadedConfig } from '../src/config.js';
import { kid, privateKeyPem } from './fixtures/access-identity.js';

const ACCESS_TEAM_DOMAIN = 'team.cloudflareaccess.com';
const ISSUER = `https://${ACCESS_TEAM_DOMAIN}`;
const AUD = 'aud-value';

// Trigger the JWKS mock (outboundService) once so createRemoteJWKSet resolves.
async function warmJwks(): Promise<void> {
  await SELF.fetch('https://worker.example.com/auth'); // any route; ignore result
}

describe('Access-JWT: exp is required', () => {
  it('rejects a correctly-signed JWT that has no exp claim', async () => {
    await warmJwks();
    const key = await importPKCS8(privateKeyPem, 'RS256');
    const noExp = await new SignJWT({ email: 'admin@example.com' })
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuedAt()
      .setIssuer(ISSUER)
      .setAudience(AUD)
      .sign(key); // deliberately no setExpirationTime()

    const result = await validateAccessJwt(
      new Request('https://worker.example.com/setup', {
        headers: { 'Cf-Access-Jwt-Assertion': noExp },
      }),
      ACCESS_TEAM_DOMAIN,
      AUD,
    );

    expect(result.ok).toBe(false);
  });

  it('still accepts a normal JWT that carries exp', async () => {
    await warmJwks();
    const key = await importPKCS8(privateKeyPem, 'RS256');
    const withExp = await new SignJWT({ email: 'admin@example.com' })
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuedAt()
      .setExpirationTime('5m')
      .setIssuer(ISSUER)
      .setAudience(AUD)
      .sign(key);

    const result = await validateAccessJwt(
      new Request('https://worker.example.com/setup', {
        headers: { 'Cf-Access-Jwt-Assertion': withExp },
      }),
      ACCESS_TEAM_DOMAIN,
      AUD,
    );

    expect(result.ok).toBe(true);
  });
});

describe('Wizard final step renders valid script markup', () => {
  const config: LoadedConfig = {
    ok: true,
    accessTeamDomain: ACCESS_TEAM_DOMAIN,
    setupAdmins: ['admin@example.com'],
    accessAppAud: AUD,
    githubAppClientId: 'Iv1.testclientid',
    allowedDomains: ['cms.example.com'],
    githubAuthUrl: undefined,
    manageUsersUrl: undefined,
    githubAuthUrlSkipped: true,
    manageUsersUrlSkipped: true,
    loginDisabled: false,
    setupComplete: true,
  };

  it('has balanced <script>/</script> tags on the finish step', async () => {
    const html = await renderWizardPage(
      7,
      config,
      'admin@example.com',
      AUD,
      'https://worker.example.com',
      pickTexts('en'),
    ).text();

    const opens = (html.match(/<script>/g) ?? []).length;
    const closes = (html.match(/<\/script>/g) ?? []).length;

    expect(opens).toBe(closes);
  });
});
