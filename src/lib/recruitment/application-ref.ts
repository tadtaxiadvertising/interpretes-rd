import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed "application reference" cookie (`rd_app_ref`).
 *
 * A postulación is keyed on the candidate's email, which anyone can type. The
 * cookie is issued only to the browser that actually created (or proved
 * ownership of) the application, so subsequent submissions/resumes can be
 * distinguished from an unauthenticated third party overwriting PII by email.
 *
 * It is NOT an authentication credential: the value is opaque, HttpOnly,
 * signed with AUTH_SECRET and bound to (candidateId, applicationId) with an
 * expiry. Guessing or tampering fails HMAC verification.
 */

export const APPLICATION_REF_COOKIE = 'rd_app_ref';
export const APPLICATION_REF_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days
const VERSION = '1';

export type ApplicationRef = {
  candidateId: number;
  applicationId: string;
  expiresAt: number; // epoch ms
};

function getSecret(): string | null {
  const secret = process.env.AUTH_SECRET?.trim();
  return secret && secret.length > 0 ? secret : null;
}

function b64urlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function b64urlDecode(value: string): string | null {
  try {
    return Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/**
 * Build the signed cookie value. Returns null when AUTH_SECRET is not
 * configured (the caller must then treat the request as unowned rather than
 * silently trusting it).
 */
export function createApplicationRef(
  candidateId: number,
  applicationId: string,
  now: number = Date.now()
): string | null {
  const secret = getSecret();
  if (!secret) return null;
  if (!Number.isSafeInteger(candidateId) || candidateId < 1) return null;
  if (!applicationId) return null;

  const payload = b64urlEncode(
    JSON.stringify({
      c: candidateId,
      a: applicationId,
      e: now + APPLICATION_REF_MAX_AGE_SEC * 1000,
    })
  );
  return `${VERSION}.${payload}.${sign(payload, secret)}`;
}

/**
 * Verify a cookie value. Returns null for missing secret, malformed value,
 * bad signature or expiry.
 */
export function verifyApplicationRef(value: string | undefined | null): ApplicationRef | null {
  if (!value) return null;
  const secret = getSecret();
  if (!secret) return null;

  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [version, payload, signature] = parts;
  if (version !== VERSION || !payload || !signature) return null;

  const expected = sign(payload, secret);
  const a = Buffer.from(signature, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const decoded = b64urlDecode(payload);
  if (!decoded) return null;

  try {
    const parsed = JSON.parse(decoded) as { c?: unknown; a?: unknown; e?: unknown };
    const candidateId = typeof parsed.c === 'number' ? parsed.c : NaN;
    const applicationId = typeof parsed.a === 'string' ? parsed.a : null;
    const expiresAt = typeof parsed.e === 'number' ? parsed.e : NaN;
    if (!Number.isSafeInteger(candidateId) || candidateId < 1) return null;
    if (!applicationId) return null;
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
    return { candidateId, applicationId, expiresAt };
  } catch {
    return null;
  }
}
