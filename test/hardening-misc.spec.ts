import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseAllowedDomains } from '../src/config.js';
import type { TokenStore } from '../src/token-store.js';
import type { Env } from '../src/types.js';
import { signTestAccessJwt } from './helpers/access-identity.js';

const testEnv = env as unknown as Env;
const ISSUER = 'https://team.cloudflareaccess.com';
const AUD = 'aud-value';
const bot = () => testEnv.TOKEN_STORE.get(testEnv.TOKEN_STORE.idFromName('bot'));

describe('parseAllowedDomains (env fallback) validates hostnames', () => {
  it('drops entries that are not bare hostnames', () => {
    const result = parseAllowedDomains('cms.example.com, https://bad.example.com, foo');
    expect(result).toEqual(['cms.example.com']);
  });
});

describe('Callback script escapes </script> in embedded JSON', () => {
  let originalEnv: Env;

  beforeEach(async () => {
    originalEnv = { ...testEnv };
    Object.assign(testEnv, {
      GITHUB_APP_CLIENT_ID: 'Iv1.testclientid',
      ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
      ACCESS_APP_AUD: AUD,
      ALLOWED_DOMAINS: 'cms.example.com',
      GITHUB_AUTH_URL: '',
      SETUP_ADMINS: 'admin@example.com',
    });
    await runInDurableObject(bot(), async (instance: TokenStore, state) => {
      await state.storage.deleteAll();
      // Pathological token containing a script-closing sequence.
      await instance.storeAuthorization({
        accessToken: 'ghu_x</script><b>',
        expiresAt: Date.now() + 4 * 3600 * 1000,
        refreshToken: 'refresh-ok',
      });
    });
  });

  afterEach(() => {
    Object.keys(testEnv).forEach((key) => delete (testEnv as unknown as Record<string, unknown>)[key]);
    Object.assign(testEnv, originalEnv);
  });

  it('does not emit a raw </script> from the token value', async () => {
    const token = await signTestAccessJwt(AUD, ISSUER);
    const response = await SELF.fetch(
      'https://worker.example.com/auth/access?site_id=cms.example.com',
      { headers: { 'Cf-Access-Jwt-Assertion': token } },
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain('ghu_x</script>'); // would break out of the <script> block
    expect(body).toContain('\\u003c'); // escaped instead
  });
});
