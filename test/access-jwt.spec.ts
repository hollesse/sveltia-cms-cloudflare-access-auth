import { describe, expect, it } from 'vitest';
import { extractAud, validateAccessJwt } from '../src/access-jwt.js';
import { signTestAccessJwt } from './helpers/access-identity.js';

const ACCESS_TEAM_DOMAIN = 'team.cloudflareaccess.com';
const ACCESS_APP_AUD = 'expected-audience';
const ISSUER = `https://${ACCESS_TEAM_DOMAIN}`;

const requestWithAssertion = (token?: string): Request =>
  new Request('https://worker.example.com/auth/access', {
    headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {},
  });

describe('validateAccessJwt', () => {
  it('accepts a correctly signed, current token with matching aud/iss', async () => {
    const token = await signTestAccessJwt(ACCESS_APP_AUD, ISSUER);

    const result = await validateAccessJwt(
      requestWithAssertion(token),
      ACCESS_TEAM_DOMAIN,
      ACCESS_APP_AUD,
    );

    expect(result.ok).toBe(true);
  });

  it('rejects a missing Cf-Access-Jwt-Assertion header', async () => {
    const result = await validateAccessJwt(requestWithAssertion(), ACCESS_TEAM_DOMAIN, ACCESS_APP_AUD);

    expect(result).toEqual({ ok: false, reason: 'missing_header' });
  });

  it('rejects a wrong audience', async () => {
    const token = await signTestAccessJwt('wrong-audience', ISSUER);

    const result = await validateAccessJwt(
      requestWithAssertion(token),
      ACCESS_TEAM_DOMAIN,
      ACCESS_APP_AUD,
    );

    expect(result.ok).toBe(false);
  });

  it('rejects a wrong issuer', async () => {
    const token = await signTestAccessJwt(ACCESS_APP_AUD, 'https://wrong-team.cloudflareaccess.com');

    const result = await validateAccessJwt(
      requestWithAssertion(token),
      ACCESS_TEAM_DOMAIN,
      ACCESS_APP_AUD,
    );

    expect(result.ok).toBe(false);
  });

  it('rejects an expired token', async () => {
    const token = await signTestAccessJwt(ACCESS_APP_AUD, ISSUER, { expiresInSeconds: -60 });

    const result = await validateAccessJwt(
      requestWithAssertion(token),
      ACCESS_TEAM_DOMAIN,
      ACCESS_APP_AUD,
    );

    expect(result.ok).toBe(false);
  });

  it('rejects a wrong signing algorithm', async () => {
    const token = await signTestAccessJwt(ACCESS_APP_AUD, ISSUER, { alg: 'HS256' });

    const result = await validateAccessJwt(
      requestWithAssertion(token),
      ACCESS_TEAM_DOMAIN,
      ACCESS_APP_AUD,
    );

    expect(result.ok).toBe(false);
  });

  it('rejects an unknown kid', async () => {
    const token = await signTestAccessJwt(ACCESS_APP_AUD, ISSUER, { kid: 'unknown-kid' });

    const result = await validateAccessJwt(
      requestWithAssertion(token),
      ACCESS_TEAM_DOMAIN,
      ACCESS_APP_AUD,
    );

    expect(result.ok).toBe(false);
  });

  describe('TOFU (optional aud, ADR 0014)', () => {
    it('accepts a token with ANY aud when accessAppAud is omitted (sig/iss/exp still enforced)', async () => {
      const token = await signTestAccessJwt('whatever-app-this-is', ISSUER);

      const result = await validateAccessJwt(requestWithAssertion(token), ACCESS_TEAM_DOMAIN);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(extractAud(result.payload.aud)).toBe('whatever-app-this-is');
      }
    });

    it('still rejects a wrong issuer when aud is omitted', async () => {
      const token = await signTestAccessJwt(
        'whatever-app-this-is',
        'https://wrong-team.cloudflareaccess.com',
      );

      const result = await validateAccessJwt(requestWithAssertion(token), ACCESS_TEAM_DOMAIN);

      expect(result.ok).toBe(false);
    });

    it('still rejects an expired token when aud is omitted', async () => {
      const token = await signTestAccessJwt('whatever-app-this-is', ISSUER, {
        expiresInSeconds: -60,
      });

      const result = await validateAccessJwt(requestWithAssertion(token), ACCESS_TEAM_DOMAIN);

      expect(result.ok).toBe(false);
    });
  });
});

describe('extractAud', () => {
  it('returns a single string aud unchanged', () => {
    expect(extractAud('single-aud')).toBe('single-aud');
  });

  it('returns the first entry of an array aud', () => {
    expect(extractAud(['first-aud', 'second-aud'])).toBe('first-aud');
  });

  it('returns undefined for an empty array or undefined', () => {
    expect(extractAud([])).toBeUndefined();
    expect(extractAud(undefined)).toBeUndefined();
  });

  describe('matching against an expected AUD (array-tolerant)', () => {
    it('matches an aud array where the expected AUD is NOT at position 0', () => {
      expect(extractAud(['other-aud', 'expected-aud'], 'expected-aud')).toBe('expected-aud');
    });

    it('does not match an aud array that lacks the expected AUD', () => {
      expect(extractAud(['other-aud', 'another-aud'], 'expected-aud')).not.toBe('expected-aud');
    });

    it('still matches a single string aud (regression)', () => {
      expect(extractAud('expected-aud', 'expected-aud')).toBe('expected-aud');
      expect(extractAud('other-aud', 'expected-aud')).not.toBe('expected-aud');
    });
  });
});
