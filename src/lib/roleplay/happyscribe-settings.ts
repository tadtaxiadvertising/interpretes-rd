import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import prisma from '@/lib/prisma';

const TOKEN_KEY = 'audio_studio_happyscribe_token_v1';
const ORG_KEY = 'audio_studio_happyscribe_organization_id';
const MEDIA_KEY = 'audio_studio_happyscribe_media_proxy';
const PREFIX = 'enc:v1:';

function masterKey(): Buffer | null {
  const raw = process.env.AUDIO_STUDIO_ENCRYPTION_KEY || '';
  if (!/^[a-f\d]{64}$/i.test(raw)) return null;
  return Buffer.from(raw, 'hex');
}

function encrypt(plaintext: string): string {
  const key = masterKey();
  if (!key) throw new Error('ENCRYPTION_KEY_MISSING');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const content = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return PREFIX + [iv, cipher.getAuthTag(), content].map(part => part.toString('base64url')).join('.');
}

function decrypt(value: string): string {
  const key = masterKey();
  if (!key || !value.startsWith(PREFIX)) throw new Error('CREDENTIAL_UNAVAILABLE');
  const parts = value.slice(PREFIX.length).split('.');
  if (parts.length !== 3) throw new Error('CREDENTIAL_INVALID');
  const [iv, tag, body] = parts.map(part => Buffer.from(part, 'base64url'));
  if (iv.length !== 12 || tag.length !== 16) throw new Error('CREDENTIAL_INVALID');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

export async function getHappyScribeSettings() {
  const rows = await prisma.systemConfig.findMany({
    where: { key: { in: [TOKEN_KEY, ORG_KEY, MEDIA_KEY] } },
    select: { key: true, value: true },
  });
  const map = new Map(rows.map(row => [row.key, row.value]));
  let token = process.env.HAPPY_SCRIBE_API_TOKEN?.trim() || '';
  if (map.has(TOKEN_KEY)) token = decrypt(map.get(TOKEN_KEY)!);
  const organizationId = map.has(ORG_KEY)
    ? map.get(ORG_KEY)!
    : process.env.HAPPY_SCRIBE_ORGANIZATION_ID?.trim() || '';
  // In the interest of VPS costs, the existing deployment feature flag remains
  // a hard safety gate. The panel can only opt out, never bypass the flag.
  const mediaImportEnabled = process.env.HAPPY_SCRIBE_MEDIA_PROXY_ENABLED === 'true'
    && map.get(MEDIA_KEY) === 'true';
  return { token, organizationId, mediaImportEnabled };
}

export async function getHappyScribeSettingsStatus() {
  const rows = await prisma.systemConfig.findMany({
    where: { key: { in: [TOKEN_KEY, ORG_KEY, MEDIA_KEY] } },
    select: { key: true, value: true },
  });
  const map = new Map(rows.map(row => [row.key, row.value]));
  return {
    hasToken: map.has(TOKEN_KEY) || Boolean(process.env.HAPPY_SCRIBE_API_TOKEN?.trim()),
    tokenSource: map.has(TOKEN_KEY) ? 'panel' : process.env.HAPPY_SCRIBE_API_TOKEN ? 'servidor' : 'ninguna',
    organizationId: map.has(ORG_KEY) ? map.get(ORG_KEY)! : (process.env.HAPPY_SCRIBE_ORGANIZATION_ID?.trim() || ''),
    // Display the effective state, not merely a persisted preference:
    // media never flows through the VPS unless the deployment gate is on.
    mediaImportEnabled: process.env.HAPPY_SCRIBE_MEDIA_PROXY_ENABLED === 'true'
      && map.get(MEDIA_KEY) === 'true',
    proxyAvailable: process.env.HAPPY_SCRIBE_MEDIA_PROXY_ENABLED === 'true',
    encryptionReady: Boolean(masterKey()),
  };
}

export async function saveHappyScribeSettings(input: {
  token?: string; organizationId: string; mediaImportEnabled: boolean; removeToken?: boolean;
}) {
  const organizationId = input.organizationId.trim();
  if (organizationId && !/^\d{1,30}$/.test(organizationId)) throw new Error('ORGANIZATION_INVALID');
  if (input.token && (input.token.length > 2048 || input.token.trim().length < 8))
    throw new Error('TOKEN_INVALID');
  if (input.token?.trim() && input.removeToken) throw new Error('TOKEN_OPERATION_CONFLICT');
  if (input.token && !masterKey()) throw new Error('ENCRYPTION_KEY_MISSING');
  await prisma.$transaction(async tx => {
    if (input.removeToken) await tx.systemConfig.deleteMany({ where: { key: TOKEN_KEY } });
    else if (input.token) await tx.systemConfig.upsert({
      where: { key: TOKEN_KEY }, create: { key: TOKEN_KEY, value: encrypt(input.token.trim()) },
      update: { value: encrypt(input.token.trim()) },
    });
    for (const [key, value] of [[ORG_KEY, organizationId], [MEDIA_KEY, String(input.mediaImportEnabled)]]) {
      await tx.systemConfig.upsert({
        where: { key }, create: { key, value }, update: { value },
      });
    }
  });
}
