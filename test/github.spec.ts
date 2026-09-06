import { describe, expect, it } from 'vitest';
import { pollDeviceFlow, refreshUserToken, startDeviceFlow } from '../src/github.js';

describe('startDeviceFlow', () => {
  it('returns user code and verification uri', async () => {
    const result = await startDeviceFlow('client-id');

    expect(result).toMatchObject({
      ok: true,
      deviceCode: 'device-ok',
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
      interval: 5,
    });
  });

  it('reports a GitHub error as failure', async () => {
    const result = await startDeviceFlow('client-fail');

    expect(result).toEqual({ ok: false, reason: 'github_error_500' });
  });
});

describe('pollDeviceFlow', () => {
  it('returns the token pair once the bot authorized', async () => {
    const result = await pollDeviceFlow('client-id', 'device-ok');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pair.accessToken).toBe('ghu_device_token');
      expect(result.pair.refreshToken).toBe('refresh-ok');
      expect(result.pair.expiresAt).toBeGreaterThan(Date.now());
    }
  });

  it('maps authorization_pending to pending', async () => {
    expect(await pollDeviceFlow('client-id', 'device-pending')).toEqual({
      ok: false,
      reason: 'pending',
    });
  });

  it('maps slow_down to slow_down', async () => {
    expect(await pollDeviceFlow('client-id', 'device-slow')).toEqual({
      ok: false,
      reason: 'slow_down',
    });
  });

  it('reports access_denied as terminal failure', async () => {
    expect(await pollDeviceFlow('client-id', 'device-denied')).toEqual({
      ok: false,
      reason: 'github_access_denied',
    });
  });
});

describe('refreshUserToken', () => {
  it('exchanges the refresh token for a fresh pair (rotated refresh token)', async () => {
    const result = await refreshUserToken('client-id', 'refresh-ok');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pair.accessToken).toBe('ghu_fresh_token');
      expect(result.pair.refreshToken).toBe('refresh-next');
    }
  });

  it('reports an invalid refresh token as failure', async () => {
    expect(await refreshUserToken('client-id', 'refresh-dead')).toEqual({
      ok: false,
      reason: 'github_bad_refresh_token',
    });
  });
});
