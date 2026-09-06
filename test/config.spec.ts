import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildLoadedConfig,
  isAllowedDomain,
  isValidHostname,
  isValidHttpsUrl,
  loadConfig,
  parseAndValidateDomains,
  resolveAnchors,
  type ConfigEnv,
} from '../src/config.js';
import type { TokenStore } from '../src/token-store.js';
import type { Env } from '../src/types.js';

const testEnv = env as unknown as Env;

const anchorsEnv = (): ConfigEnv => ({
  ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
  SETUP_ADMINS: 'Admin@Example.com',
});

describe('resolveAnchors', () => {
  it('resolves the two mandatory trust anchors (ADR 0014)', () => {
    const result = resolveAnchors(anchorsEnv());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.accessTeamDomain).toBe('team.cloudflareaccess.com');
      expect(result.setupAdmins).toEqual(['admin@example.com']);
    }
  });

  it('reports every missing anchor by name', () => {
    const result = resolveAnchors({ ACCESS_TEAM_DOMAIN: '  ' });

    expect(result).toEqual({
      ok: false,
      reason: 'missing_required',
      missingKeys: ['ACCESS_TEAM_DOMAIN', 'SETUP_ADMINS'],
    });
  });
});

describe('buildLoadedConfig', () => {
  const anchors = { accessTeamDomain: 'team.cloudflareaccess.com', setupAdmins: ['admin@example.com'] };

  it('falls back to env values when no DO setting is present (migration path)', () => {
    const config = buildLoadedConfig(anchors, {}, {
      ...anchorsEnv(),
      ACCESS_APP_AUD: 'env-aud',
      GITHUB_APP_CLIENT_ID: 'env-client-id',
      ALLOWED_DOMAINS: 'cms.example.com, other.example.org',
      GITHUB_AUTH_URL: 'https://auth.example.net',
      MANAGE_EDITORS_URL: 'https://dash.example.com/policy',
    });

    expect(config).toMatchObject({
      accessAppAud: 'env-aud',
      githubAppClientId: 'env-client-id',
      allowedDomains: ['cms.example.com', 'other.example.org'],
      githubAuthUrl: 'https://auth.example.net',
      manageEditorsUrl: 'https://dash.example.com/policy',
      setupComplete: true,
    });
  });

  it('prefers the DO setting over the env fallback', () => {
    const config = buildLoadedConfig(
      anchors,
      { accessAppAud: 'do-aud', allowedDomains: ['do.example.com'] },
      { ...anchorsEnv(), ACCESS_APP_AUD: 'env-aud', ALLOWED_DOMAINS: 'env.example.com' },
    );

    expect(config.accessAppAud).toBe('do-aud');
    expect(config.allowedDomains).toEqual(['do.example.com']);
  });

  it('is setupComplete=false while AUD, client ID, or allowed domains are missing', () => {
    expect(buildLoadedConfig(anchors, {}, anchorsEnv()).setupComplete).toBe(false);
    expect(
      buildLoadedConfig(anchors, { accessAppAud: 'aud', githubAppClientId: 'id' }, anchorsEnv())
        .setupComplete,
    ).toBe(false);
    expect(
      buildLoadedConfig(
        anchors,
        { accessAppAud: 'aud', githubAppClientId: 'id', allowedDomains: ['cms.example.com'] },
        anchorsEnv(),
      ).setupComplete,
    ).toBe(true);
  });
});

describe('loadConfig', () => {
  let originalEnv: Env;

  beforeEach(() => {
    originalEnv = { ...testEnv };
  });

  afterEach(() => {
    Object.keys(testEnv).forEach((key) => {
      delete (testEnv as unknown as Record<string, unknown>)[key];
    });
    Object.assign(testEnv, originalEnv);
  });

  it('reports missing_required when an anchor env var is absent', async () => {
    Object.assign(testEnv, { ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', SETUP_ADMINS: '' });

    const result = await loadConfig(testEnv);

    expect(result).toEqual({
      ok: false,
      reason: 'missing_required',
      missingKeys: ['SETUP_ADMINS'],
    });
  });

  it('reads settings from the TokenStore DO (fixed "bot" instance) and falls back to env', async () => {
    Object.assign(testEnv, {
      ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
      SETUP_ADMINS: 'admin@example.com',
      ACCESS_APP_AUD: 'env-aud-should-be-shadowed',
      GITHUB_APP_CLIENT_ID: 'env-client-id',
      ALLOWED_DOMAINS: 'cms.example.com',
    });

    const tokenStore = testEnv.TOKEN_STORE.get(testEnv.TOKEN_STORE.idFromName('bot'));

    await runInDurableObject(tokenStore, (instance: TokenStore) =>
      instance.updateSettings({ accessAppAud: 'pinned-aud' }),
    );

    const result = await loadConfig(testEnv);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.accessAppAud).toBe('pinned-aud');
      expect(result.githubAppClientId).toBe('env-client-id');
    }
  });
});

describe('isAllowedDomain', () => {
  const allowed = ['cms.example.com', 'other.example.org'];

  it('matches exact domains case-insensitively', () => {
    expect(isAllowedDomain('CMS.Example.com', allowed)).toBe(true);
  });

  it('matches subdomains of an allowed entry', () => {
    expect(isAllowedDomain('www.cms.example.com', allowed)).toBe(true);
  });

  it('rejects foreign domains and suffix tricks', () => {
    expect(isAllowedDomain('evilcms.example.com.attacker.net', allowed)).toBe(false);
    expect(isAllowedDomain('notcms.example.com', allowed)).toBe(false);
  });

  it('rejects the empty domain', () => {
    expect(isAllowedDomain('', allowed)).toBe(false);
    expect(isAllowedDomain('   ', allowed)).toBe(false);
  });
});

describe('isValidHostname', () => {
  it('accepts plain hostnames', () => {
    expect(isValidHostname('cms.example.com')).toBe(true);
  });

  it('rejects a scheme, a path, or an empty value', () => {
    expect(isValidHostname('https://cms.example.com')).toBe(false);
    expect(isValidHostname('cms.example.com/path')).toBe(false);
    expect(isValidHostname('')).toBe(false);
  });
});

describe('parseAndValidateDomains', () => {
  it('parses a comma-separated, trimmed, lowercased list', () => {
    expect(parseAndValidateDomains(' CMS.Example.com , other.example.org ')).toEqual({
      ok: true,
      domains: ['cms.example.com', 'other.example.org'],
    });
  });

  it('reports the first invalid entry (scheme/path)', () => {
    expect(parseAndValidateDomains('cms.example.com, https://bad.example.com')).toEqual({
      ok: false,
      reason: 'invalid_domain',
      domain: 'https://bad.example.com',
    });
  });

  it('reports empty_domains for a blank input', () => {
    expect(parseAndValidateDomains('   ')).toEqual({ ok: false, reason: 'empty_domains' });
  });
});

describe('isValidHttpsUrl', () => {
  it('accepts an https URL', () => {
    expect(isValidHttpsUrl('https://auth.example.net')).toBe(true);
  });

  it('rejects http and malformed input', () => {
    expect(isValidHttpsUrl('http://auth.example.net')).toBe(false);
    expect(isValidHttpsUrl('not a url')).toBe(false);
  });
});
