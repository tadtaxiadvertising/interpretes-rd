import { createHmac, timingSafeEqual } from 'node:crypto';

type Identity = {
  id: string;
  email: string;
  role: string;
  password: string;
  updatedAt: Date;
};

/** Bind a token to the current account revision without publishing a hash or
 * raw revision material. Domain separation distinguishes this from JWT signing.
 * A restored role still requires a new login after normal Prisma updates. */
export function sessionRevision(identity: Identity, secret: string): string {
  const key = createHmac('sha256', secret).update('interpreters-api/session-revision/key/v1').digest();
  return createHmac('sha256', key).update(JSON.stringify([
    identity.id, identity.email, identity.role, identity.password,
    identity.updatedAt.toISOString(),
  ])).digest('hex');
}

export function matchesSessionRevision(value: unknown, identity: Identity, secret: string): boolean {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return false;
  return timingSafeEqual(Buffer.from(value, 'hex'), Buffer.from(sessionRevision(identity, secret), 'hex'));
}
