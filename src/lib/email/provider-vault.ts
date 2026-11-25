import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readOperationalMailConfig, type OperationalMailConfig } from './operational-config';
import { providerCatalog, isProviderId, type ProviderId } from './provider-catalog';

export type ProfileInput = { name: string; provider: ProviderId; from: string; replyTo: string; apiKey: string; secretKey?: string };
export type ProfileMetadata = Omit<ProfileInput, 'apiKey' | 'secretKey'> & { id: string; updatedAt: string };

function keyFromEnv(value: string | undefined): Buffer | null {
  return value && /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, 'hex') : null;
}
export function vaultKeyAvailable(value: string | undefined): boolean {
  return keyFromEnv(value) !== null;
}

export function validateProfile(input: unknown): ProfileInput | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  if (!isProviderId(value.provider)) return null;
  if (typeof value.name !== 'string' || typeof value.from !== 'string' || typeof value.replyTo !== 'string' || typeof value.apiKey !== 'string') return null;
  const name = value.name.trim();
  if (!name || name.length > 80 || /[\x00-\x1f\x7f]/.test(name) || value.from.length > 254 || value.replyTo.length > 254 || value.apiKey.length > 512) return null;
  const preset = providerCatalog[value.provider];
  if (preset.mode === 'smtp') {
    if (typeof value.secretKey !== 'string' || !value.apiKey || !value.secretKey
      || !/^[!-~]{1,200}$/.test(value.apiKey) || !/^[!-~]{1,200}$/.test(value.secretKey)
      || value.apiKey.includes(':') || Buffer.byteLength(JSON.stringify([value.apiKey, value.secretKey]), 'utf8') > 512) return null;
    const result = readOperationalMailConfig({
      OPERATIONAL_EMAIL_ENABLED: 'true', OPERATIONAL_EMAIL_PROVIDER: 'smtp',
      OPERATIONAL_EMAIL_FROM: value.from, OPERATIONAL_EMAIL_REPLY_TO: value.replyTo,
      OPERATIONAL_SMTP_HOST: preset.host, OPERATIONAL_SMTP_PORT: '587',
      OPERATIONAL_SMTP_USER: value.apiKey, OPERATIONAL_SMTP_PASSWORD: value.secretKey,
    });
    return result.status === 'configured' && result.provider === 'smtp'
      ? { name, provider: value.provider, from: result.config.from, replyTo: result.config.replyTo ?? '', apiKey: result.config.user, secretKey: result.config.password } : null;
  }
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

/** Keep existing single-key ciphertext compatible. Encrypt both SMTP credentials
 * together using the existing authenticated profile identity. */
export function sealProfileCredentials(id: string, profile: ProfileInput, envKey: string | undefined): string {
  const secret = providerCatalog[profile.provider].mode === 'smtp'
    ? JSON.stringify([profile.apiKey, profile.secretKey]) : profile.apiKey;
  return sealProfileKey(id, profile.provider, secret, envKey);
}
export function openProfileCredentials(id: string, provider: ProviderId, sealed: string, envKey: string | undefined): { apiKey: string; secretKey?: string } | null {
  const secret = openProfileKey(id, provider, sealed, envKey);
  if (!secret) return null;
  if (providerCatalog[provider].mode === 'api') return { apiKey: secret };
  try {
    const pair: unknown = JSON.parse(secret);
    return Array.isArray(pair) && pair.length === 2 && pair.every(x => typeof x === 'string')
      ? { apiKey: pair[0], secretKey: pair[1] } : null;
  } catch { return null; }
}
export function profileSmtpConfig(profile: ProfileInput): OperationalMailConfig | null {
  const preset = providerCatalog[profile.provider];
  if (preset.mode !== 'smtp' || !profile.secretKey) return null;
  const result = readOperationalMailConfig({
    OPERATIONAL_EMAIL_ENABLED: 'true', OPERATIONAL_EMAIL_PROVIDER: 'smtp',
    OPERATIONAL_SMTP_HOST: preset.host, OPERATIONAL_SMTP_PORT: '587',
    OPERATIONAL_SMTP_USER: profile.apiKey, OPERATIONAL_SMTP_PASSWORD: profile.secretKey,
    OPERATIONAL_EMAIL_FROM: profile.from, OPERATIONAL_EMAIL_REPLY_TO: profile.replyTo,
  });
  return result.status === 'configured' && result.provider === 'smtp' ? result.config : null;
}
