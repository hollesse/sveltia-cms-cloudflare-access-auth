import { importPKCS8, SignJWT } from 'jose';
import { kid as fixtureKid, privateKeyPem } from '../fixtures/access-identity.js';

export interface SignAccessJwtOptions {
  aud?: string;
  iss?: string;
  expiresInSeconds?: number;
  alg?: 'RS256' | 'HS256';
  kid?: string | null;
  email?: string;
}

const HMAC_SECRET = new TextEncoder().encode('test-hmac-secret-fuer-falsches-alg');

/**
 * Signiert ein Test-Access-JWT mit dem pro Testlauf generierten RSA-Keypair
 * (siehe `vitest.config.mts`, ADR 0006/0010). Der oeffentliche Teil ist im
 * gemockten `outboundService`-Worker als JWKS hinterlegt.
 */
export async function signTestAccessJwt(
  defaultAud: string,
  defaultIss: string,
  options: SignAccessJwtOptions = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const alg = options.alg ?? 'RS256';
  const kid = options.kid === undefined ? fixtureKid : (options.kid ?? undefined);

  const jwt = new SignJWT({ email: options.email ?? 'nutzerin@example.com' })
    .setProtectedHeader(kid ? { alg, kid } : { alg })
    .setIssuedAt(now)
    .setExpirationTime(now + (options.expiresInSeconds ?? 300))
    .setIssuer(options.iss ?? defaultIss)
    .setAudience(options.aud ?? defaultAud);

  if (alg === 'HS256') {
    return jwt.sign(HMAC_SECRET);
  }

  const privateKey = await importPKCS8(privateKeyPem, 'RS256');

  return jwt.sign(privateKey);
}
