/**
 * GitHub-OAuth-Endpunkte fuer den App-User-Token-Flow des Bot-Accounts
 * (Research-Report github-app-user-token-refresh-2026-09-04, Review: PASS):
 * Device Flow fuer die Einmal-Autorisierung, Refresh-Grant fuer die
 * laufende Token-Rotation. Kein client_secret noetig, da die Autorisierung
 * per Device Flow erfolgt. Access-Tokens (ghu_) leben fix 8 h; das Einloesen
 * des Refresh-Tokens invalidiert das alte Access- UND Refresh-Token sofort
 * (single-use) — Serialisierung uebernimmt das TokenStore-Durable-Object.
 */

const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const GITHUB_OAUTH_TOKEN_URL = 'https://github.com/login/oauth/access_token';

export interface TokenPair {
  accessToken: string;
  /** Epoch-Millisekunden, ab denen das Access-Token als abgelaufen gilt. */
  expiresAt: number;
  refreshToken: string;
}

export interface DeviceFlowStart {
  ok: true;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** Poll-Intervall in Sekunden (GitHub-Vorgabe, Basis fuer slow_down). */
  interval: number;
  expiresIn: number;
}

export interface GithubFlowError {
  ok: false;
  reason: string;
}

interface OauthTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  error?: string;
}

const jsonHeaders = {
  accept: 'application/json',
  'content-type': 'application/json',
  'user-agent': 'sveltia-cms-cloudflare-access-auth',
};

function toTokenPair(data: OauthTokenResponse): TokenPair | undefined {
  if (!data.access_token || !data.refresh_token || typeof data.expires_in !== 'number') {
    return undefined;
  }

  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    refreshToken: data.refresh_token,
  };
}

/** Startet den Device Flow: liefert User-Code + Verifikations-URL. */
export async function startDeviceFlow(
  clientId: string,
): Promise<DeviceFlowStart | GithubFlowError> {
  let response: Response | undefined;

  // GitHubs Device-Code-Endpunkt antwortet gelegentlich transient mit 5xx
  // (live beobachtet 2026-09-04): ein automatischer Wiederholungsversuch
  // mit kurzer Pause faengt das ab, ohne echte Fehler zu verschleiern.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetch(GITHUB_DEVICE_CODE_URL, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ client_id: clientId }),
      });
    } catch {
      return { ok: false, reason: 'github_unreachable' };
    }

    if (response.status < 500 || attempt === 1) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  if (!response || !response.ok) {
    return { ok: false, reason: `github_error_${response?.status ?? 'unknown'}` };
  }

  const data = (await response.json()) as {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    interval?: number;
    expires_in?: number;
  };

  if (!data.device_code || !data.user_code || !data.verification_uri) {
    return { ok: false, reason: 'github_malformed_response' };
  }

  return {
    ok: true,
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    interval: data.interval ?? 5,
    expiresIn: data.expires_in ?? 900,
  };
}

export type DeviceFlowPollResult =
  | { ok: true; pair: TokenPair }
  | { ok: false; reason: 'pending' | 'slow_down' }
  | GithubFlowError;

/** Ein einzelner Poll-Versuch des Device Flows (das Browser-Setup-UI taktet). */
export async function pollDeviceFlow(
  clientId: string,
  deviceCode: string,
): Promise<DeviceFlowPollResult> {
  let response: Response;

  try {
    response = await fetch(GITHUB_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
  } catch {
    return { ok: false, reason: 'github_unreachable' };
  }

  const data = (await response.json()) as OauthTokenResponse;

  if (data.error === 'authorization_pending') {
    return { ok: false, reason: 'pending' };
  }

  if (data.error === 'slow_down') {
    return { ok: false, reason: 'slow_down' };
  }

  if (data.error) {
    return { ok: false, reason: `github_${data.error}` };
  }

  const pair = toTokenPair(data);

  if (!pair) {
    return { ok: false, reason: 'github_malformed_response' };
  }

  return { ok: true, pair };
}

export type RefreshResult = { ok: true; pair: TokenPair } | GithubFlowError;

/**
 * Loest das (single-use) Refresh-Token gegen ein frisches Token-Paar ein.
 * NUR vom TokenStore-Durable-Object aufrufen — nie direkt aus einem
 * Request-Handler (Serialisierungs-Invariante).
 */
export async function refreshUserToken(
  clientId: string,
  refreshToken: string,
): Promise<RefreshResult> {
  let response: Response;

  try {
    response = await fetch(GITHUB_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        client_id: clientId,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });
  } catch {
    return { ok: false, reason: 'github_unreachable' };
  }

  const data = (await response.json()) as OauthTokenResponse;

  if (data.error) {
    return { ok: false, reason: `github_${data.error}` };
  }

  const pair = toTokenPair(data);

  if (!pair) {
    return { ok: false, reason: 'github_malformed_response' };
  }

  return { ok: true, pair };
}
