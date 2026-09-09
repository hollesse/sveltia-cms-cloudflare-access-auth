import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

const ACCESS_JWT_HEADER = 'Cf-Access-Jwt-Assertion';

/**
 * Eine `createRemoteJWKSet`-Instanz pro `ACCESS_TEAM_DOMAIN`, im Modul-Scope
 * gehalten (ADR 0005) — ueberlebt so lange wie der Isolate, cacht das JWKS
 * gemaess `jose`-internem `cacheMaxAge`/`cooldownDuration`-Verhalten.
 */
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(accessTeamDomain: string): ReturnType<typeof createRemoteJWKSet> {
  let jwks = jwksCache.get(accessTeamDomain);

  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL(`https://${accessTeamDomain}/cdn-cgi/access/certs`),
      { cacheMaxAge: 60 * 60 * 1000 },
    );
    jwksCache.set(accessTeamDomain, jwks);
  }

  return jwks;
}

export interface AccessJwtValidationSuccess {
  ok: true;
  payload: JWTPayload;
}

export interface AccessJwtValidationFailure {
  ok: false;
  reason: 'missing_header' | 'invalid';
}

export type AccessJwtValidationResult = AccessJwtValidationSuccess | AccessJwtValidationFailure;

/**
 * Validiert das `Cf-Access-Jwt-Assertion`-Header-JWT kryptographisch gegen
 * das Cloudflare-Access-JWKS (ADR 0005): `algorithms: ['RS256']`, `issuer`
 * und (sofern bekannt) `audience` werden erzwungen. Reine Header-Anwesenheit
 * wird niemals als ausreichend behandelt.
 *
 * `accessAppAud` ist OPTIONAL (ADR 0014, TOFU-AUD-Wizard): fehlt es, wird
 * Signatur + `iss` + `exp` dennoch vollstaendig geprueft, nur die Audience-
 * Pruefung entfaellt. Genutzt ausschliesslich fuer den allerersten
 * Setup-Schritt, bevor ein AUD gepinnt ist — der Redakteurs-Login
 * (`/auth/access`) verlangt IMMER ein bekanntes AUD und ruft diese Funktion
 * dafuer nie ohne `accessAppAud` auf.
 */
export async function validateAccessJwt(
  request: Request,
  accessTeamDomain: string,
  accessAppAud?: string,
): Promise<AccessJwtValidationResult> {
  const token = request.headers.get(ACCESS_JWT_HEADER);

  if (!token) {
    return { ok: false, reason: 'missing_header' };
  }

  try {
    const { payload } = await jwtVerify(token, getJwks(accessTeamDomain), {
      algorithms: ['RS256'],
      issuer: `https://${accessTeamDomain}`,
      requiredClaims: ['exp'],
      ...(accessAppAud !== undefined ? { audience: accessAppAud } : {}),
    });

    return { ok: true, payload };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

/** Liest den `aud`-Claim als einzelnen String (Cloudflare Access setzt ihn
 * i.d.R. als String; `jose` typisiert ihn dennoch als `string | string[]`).
 *
 * Array-tauglich (nicht nur `aud[0]`): ist `expectedAud` angegeben und in
 * einem `aud`-Array enthalten — unabhaengig von seiner Position —, wird
 * `expectedAud` zurueckgegeben, sodass Aufrufer die konfigurierte AUD auch
 * dann korrekt matchen, wenn sie nicht an erster Stelle steht. Andernfalls
 * (kein `expectedAud`, oder nicht enthalten) faellt die Funktion auf den
 * bisherigen Anzeige-/Pinning-Wert `aud[0]` zurueck. */
export function extractAud(
  aud: string | string[] | undefined,
  expectedAud?: string,
): string | undefined {
  if (typeof aud === 'string') {
    return aud;
  }

  if (Array.isArray(aud)) {
    if (expectedAud !== undefined && aud.includes(expectedAud)) {
      return expectedAud;
    }

    if (aud.length > 0 && typeof aud[0] === 'string') {
      return aud[0];
    }
  }

  return undefined;
}
