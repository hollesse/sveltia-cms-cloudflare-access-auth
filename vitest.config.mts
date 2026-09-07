import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { configDefaults, defineConfig } from 'vitest/config';
import { jwks } from './test/fixtures/access-identity.js';

/**
 * `@cloudflare/vitest-pool-workers` hat `fetchMock` (ADR 0006) in den
 * vitest-4-kompatiblen Releases entfernt (siehe ADR 0010). Ersatz: ein
 * statischer `outboundService`-Mock-Worker (Miniflare-Bordmittel), der ALLE
 * ausgehenden Requests des Workers unter Test abfaengt und anhand des
 * Pfads (JWKS-Endpoint bzw. `installationId`-Segment) antwortet.
 */
const mockUpstreamScript = `
export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/cdn-cgi/access/certs') {
      return new Response(${JSON.stringify(JSON.stringify(jwks))}, {
        headers: { 'content-type': 'application/json' },
      });
    }

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
      });

    // Mock des externen sveltia-cms-auth (Option-C-Proxy-Tests).
    if (url.hostname === 'sveltia-cms-auth.example.net') {
      if (url.pathname === '/auth') {
        return new Response(null, {
          status: 302,
          headers: {
            location:
              'https://github.com/login/oauth/authorize?client_id=ext&state=teststate&scope=repo&site=' +
              (url.searchParams.get('site_id') ?? ''),
            'set-cookie': 'csrf-token=github_00000000000000000000000000000000; HttpOnly; Path=/; Max-Age=600; SameSite=Lax; Secure',
          },
        });
      }

      if (url.pathname === '/callback') {
        const cookie = request.headers.get('cookie') ?? '';
        const headers = new Headers({ 'content-type': 'text/html;charset=UTF-8' });
        headers.append(
          'set-cookie',
          'csrf-token=deleted; HttpOnly; Max-Age=0; Path=/; SameSite=Lax; Secure',
        );

        // Feindlicher/kompromittierter Upstream: versucht, ein Access-Cookie im
        // Browser zu setzen. Der Proxy MUSS das herausfiltern.
        if (url.searchParams.get('inject') === 'cf') {
          headers.append('set-cookie', 'CF_Authorization=upstream-injected; Path=/; Secure; HttpOnly');
        }

        return new Response(
          '<!doctype html><script>/* authorization:github:success */</script><!-- cookie:' +
            cookie +
            ' code:' +
            (url.searchParams.get('code') ?? '') +
            ' -->',
          { status: 200, headers },
        );
      }

      return new Response('ext not found', { status: 404 });
    }

    // GitHub API — Konto-Verifikation nach dem Device Flow (auth-v8n3c).
    if (url.hostname === 'api.github.com') {
      const auth = request.headers.get('authorization') ?? '';

      if (url.pathname === '/user') {
        if (auth.includes('ghu_bad')) {
          return new Response('bad credentials', { status: 401 });
        }

        return json({ login: 'myclub-cms-bot', id: 4242 });
      }

      if (url.pathname === '/user/installations') {
        return json({ total_count: 1, installations: [{ id: 1 }] });
      }

      return new Response('gh api not found', { status: 404 });
    }

    if (url.pathname === '/login/device/code') {
      const body = await request.json();

      if (body.client_id === 'client-fail') {
        return json({ message: 'mocked failure' }, 500);
      }

      return json({
        device_code: body.client_id === 'client-pending' ? 'device-pending' : 'device-ok',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        interval: 5,
        expires_in: 900,
      });
    }

    if (url.pathname === '/login/oauth/access_token') {
      const body = await request.json();

      if (body.grant_type === 'refresh_token') {
        if (body.refresh_token === 'refresh-ok') {
          return json({
            access_token: 'ghu_fresh_token',
            expires_in: 28800,
            refresh_token: 'refresh-next',
            token_type: 'bearer',
          });
        }

        return json({ error: 'bad_refresh_token' });
      }

      if (body.grant_type === 'urn:ietf:params:oauth:grant-type:device_code') {
        if (body.device_code === 'device-ok') {
          return json({
            access_token: 'ghu_device_token',
            expires_in: 28800,
            refresh_token: 'refresh-ok',
            token_type: 'bearer',
          });
        }

        if (body.device_code === 'device-badaccount') {
          return json({
            access_token: 'ghu_bad',
            expires_in: 28800,
            refresh_token: 'refresh-ok',
            token_type: 'bearer',
          });
        }

        if (body.device_code === 'device-pending') {
          return json({ error: 'authorization_pending' });
        }

        if (body.device_code === 'device-slow') {
          return json({ error: 'slow_down' });
        }

        return json({ error: 'access_denied' });
      }
    }

    return new Response('unhandled mock request: ' + url.pathname, { status: 599 });
  },
};
`;

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        outboundService: 'mock-upstream',
        workers: [
          {
            name: 'mock-upstream',
            modules: true,
            script: mockUpstreamScript,
            compatibilityDate: '2026-08-22',
          },
        ],
      },
    }),
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
    // Playwright-Browser-Tests laufen separat (siehe playwright.config.ts).
    exclude: [...configDefaults.exclude, 'test/e2e/**'],
  },
});
