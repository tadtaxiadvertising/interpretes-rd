import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readOperationalMailConfig } from './operational-config';

export type ProfileInput = { name: string; provider: 'brevo' | 'resend'; from: string; replyTo: string; apiKey: string };
export type ProfileMetadata = Omit<ProfileInput, 'apiKey'> & { id: string; updatedAt: string };

function keyFromEnv(value: string | undefined): Buffer | null {
  return value && /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, 'hex') : null;
}
export function vaultKeyAvailable(value: string | undefined): boolean {
  return keyFromEnv(value) !== null;
}

export function validateProfile(input: unknown): ProfileInput | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  if (value.provider !== 'brevo' && value.provider !== 'resend') return null;
  if (typeof value.name !== 'string' || typeof value.from !== 'string' || typeof value.replyTo !== 'string' || typeof value.apiKey !== 'string') return null;
  const name = value.name.trim();
  if (!name || name.length > 80 || /[\x00-\x1f\x7f]/.test(name) || value.from.length > 254 || value.replyTo.length > 254 || value.apiKey.length > 512) return null;
  const result = readOperationalMailConfig({
    OPERATIONAL_EMAIL_ENABLED: 'true', OPERATIONAL_EMAIL_PROVIDER: value.provider,
    OPERATIONAL_EMAIL_FROM: value.from, OPERATIONAL_EMAIL_REPLY_TO: value.replyTo,
    BREVO_API_KEY: value.provider === 'brevo' ? value.apiKey : undefined,
    RESEND_API_KEY: value.provider === 'resend' ? value.apiKey : undefined,
  });
  if (result.status !== 'configured' || result.provider === 'smtp') return null;
  return { name, provider: result.provider, from: result.config.from, replyTo: result.config.replyTo ?? '', apiKey: result.config.apiKey };
}

/** Bind the secret to the immutable profile identity and transport, preventing row swaps. */
export function sealProfileKey(id: string, provider: ProfileInput['provider'], secret: string, envKey: string | undefined): string {
  const key = keyFromEnv(envKey);
  if (!key) throw new Error('Vault unavailable');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from('ird-mail-v1:' + id + ':' + provider));
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', nonce.toString('hex'), cipher.getAuthTag().toString('hex'), encrypted.toString('hex')].join(':');
}

export function openProfileKey(id: string, provider: ProfileInput['provider'], sealed: string, envKey: string | undefined): string | null {
  const key = keyFromEnv(envKey);
  if (!key || sealed.length > 1200) return null;
  const [version, nonce, tag, encrypted, extra] = sealed.split(':');
  if (version !== 'v1' || extra !== undefined || !/^[0-9a-f]{24}$/.test(nonce ?? '') || !/^[0-9a-f]{32}$/.test(tag ?? '') || !/^(?:[0-9a-f]{2}){1,512}$/.test(encrypted ?? '')) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'hex'));
    decipher.setAAD(Buffer.from('ird-mail-v1:' + id + ':' + provider));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
