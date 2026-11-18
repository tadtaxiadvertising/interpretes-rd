// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({
  default: {
    systemConfig: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import prisma from '@/lib/prisma';
import {
  getHappyScribeSettings,
  getHappyScribeSettingsStatus,
  getAudioStudioEditorPreferences,
  saveHappyScribeSettings,
} from './happyscribe-settings';
import { issueHappyScribeImportProof, verifyHappyScribeImportProof } from './happyscribe-import-proof';

const TOKEN_KEY = 'audio_studio_happyscribe_token_v1';
const originalEnv = {
  key: process.env.AUDIO_STUDIO_ENCRYPTION_KEY,
  token: process.env.HAPPY_SCRIBE_API_TOKEN,
  org: process.env.HAPPY_SCRIBE_ORGANIZATION_ID,
  media: process.env.HAPPY_SCRIBE_MEDIA_PROXY_ENABLED,
};
const store = new Map<string, string>();
const testToken = 'SYNTHETIC_NOT_A_REAL_HAPPYSCRIBE_TOKEN_1234';

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  process.env.AUDIO_STUDIO_ENCRYPTION_KEY = 'a'.repeat(64);
  delete process.env.HAPPY_SCRIBE_API_TOKEN;
  delete process.env.HAPPY_SCRIBE_ORGANIZATION_ID;
  delete process.env.HAPPY_SCRIBE_MEDIA_PROXY_ENABLED;
  vi.mocked(prisma.systemConfig.findMany).mockImplementation(async () =>
    Array.from(store.entries()).map(([key, value]) => ({ key, value })) as never,
  );
  vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) =>
    callback({
      systemConfig: {
        upsert: async ({ where, create, update }: any) => {
          store.set(where.key, store.has(where.key) ? update.value : create.value);
        },
        deleteMany: async ({ where }: any) => {
          store.delete(where.key);
        },
      },
    }),
  );
});

afterEach(() => {
  for (const [key, value] of [
    ['AUDIO_STUDIO_ENCRYPTION_KEY', originalEnv.key],
    ['HAPPY_SCRIBE_API_TOKEN', originalEnv.token],
    ['HAPPY_SCRIBE_ORGANIZATION_ID', originalEnv.org],
    ['HAPPY_SCRIBE_MEDIA_PROXY_ENABLED', originalEnv.media],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('HappyScribe encrypted admin settings', () => {
  it('validates import selections by admin, organization and expiry before the dependency audit', () => {
    const scope = { id: 'a'.repeat(40), organizationId: '12345', userId: 'synthetic-admin', token: testToken };
    const issued = issueHappyScribeImportProof(scope, 1_800_000_000_000);
    expect(verifyHappyScribeImportProof(scope, issued, 1_800_000_060_000)).toBe(true);
    expect(verifyHappyScribeImportProof({ ...scope, organizationId: '98765' }, issued, 1_800_000_060_000)).toBe(false);
    expect(verifyHappyScribeImportProof({ ...scope, userId: 'another-admin' }, issued, 1_800_000_060_000)).toBe(false);
    expect(verifyHappyScribeImportProof(scope, issued, 1_800_002_760_000)).toBe(false);
  });


  it('encrypts secrets using a random IV and never returns them in status', async () => {
    const input = { token: testToken, organizationId: '123456', mediaImportEnabled: false };
    await saveHappyScribeSettings(input);
    const first = store.get(TOKEN_KEY)!;
    expect(first).toMatch(/^enc:v1:/);
    expect(first).not.toContain(testToken);
    await saveHappyScribeSettings(input);
    const second = store.get(TOKEN_KEY)!;
    expect(second).not.toBe(first);
    expect((await getHappyScribeSettings()).token).toBe(testToken);
    const status = await getHappyScribeSettingsStatus();
    expect(status.hasToken).toBe(true);
    expect(status.credentialUsable).toBe(true);
    expect(status.organizationId).toBe('123456');
    expect(JSON.stringify(status)).not.toContain(testToken);
  });

  it('reports server-key fallback before removing a panel token', async () => {
    const serverToken = 'SYNTHETIC_SERVER_FALLBACK_NOT_REAL';
    process.env.HAPPY_SCRIBE_API_TOKEN = serverToken;
    await saveHappyScribeSettings({
      token: testToken, organizationId: '123456', mediaImportEnabled: false,
    });
    const before = await getHappyScribeSettingsStatus();
    expect(before.tokenSource).toBe('panel');
    expect(before.environmentFallbackAvailable).toBe(true);
    expect(JSON.stringify(before)).not.toContain(serverToken);
    expect(JSON.stringify(before)).not.toContain(testToken);

    await saveHappyScribeSettings({
      removeToken: true, organizationId: '123456', mediaImportEnabled: false,
    });
    const after = await getHappyScribeSettingsStatus();
    expect(after.tokenSource).toBe('servidor');
    expect(after.environmentFallbackAvailable).toBe(true);
    expect((await getHappyScribeSettings()).token).toBe(serverToken);
  });


  it('immediately disables all provider access while retaining encrypted credentials', async () => {
    process.env.HAPPY_SCRIBE_API_TOKEN = 'SYNTHETIC_SERVER_FALLBACK_KEY';
    process.env.HAPPY_SCRIBE_ORGANIZATION_ID = '98765';
    process.env.HAPPY_SCRIBE_MEDIA_PROXY_ENABLED = 'true';
    await saveHappyScribeSettings({
      token: testToken, organizationId: '123456', mediaImportEnabled: true,
      integrationEnabled: false,
    });
    const ciphertext = store.get(TOKEN_KEY);
    expect(ciphertext).toMatch(/^enc:v1:/);
    expect(await getHappyScribeSettings()).toEqual({
      token: '', organizationId: '', mediaImportEnabled: false,
    });
    const disabled = await getHappyScribeSettingsStatus();
    expect(disabled.integrationEnabled).toBe(false);
    expect(disabled.mediaImportEnabled).toBe(false);
    expect(disabled.hasToken).toBe(true);
    expect(JSON.stringify(disabled)).not.toContain(testToken);

    await saveHappyScribeSettings({
      organizationId: '123456', mediaImportEnabled: true,
      integrationEnabled: true,
    });
    expect(store.get(TOKEN_KEY)).toBe(ciphertext);
    expect(await getHappyScribeSettings()).toEqual({
      token: testToken, organizationId: '123456', mediaImportEnabled: true,
    });
  });

  it('blocks environment-token fallback even if no panel token was saved', async () => {
    process.env.HAPPY_SCRIBE_API_TOKEN = 'SYNTHETIC_OLD_SERVER_TOKEN';
    process.env.HAPPY_SCRIBE_ORGANIZATION_ID = '123456';
    await saveHappyScribeSettings({
      organizationId: '123456', mediaImportEnabled: false,
      integrationEnabled: false,
    });
    expect((await getHappyScribeSettings()).token).toBe('');
  });

  it('rejects malformed enablement flags before saving configuration', async () => {
    await expect(saveHappyScribeSettings({
      organizationId: '123456', mediaImportEnabled: false,
      integrationEnabled: 'maybe' as unknown as boolean,
    })).rejects.toThrow('ENABLED_PREFERENCE_INVALID');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('fails closed without the runtime encryption key before any database write', async () => {
    delete process.env.AUDIO_STUDIO_ENCRYPTION_KEY;
    await expect(saveHappyScribeSettings({
      token: testToken, organizationId: '123456', mediaImportEnabled: false,
    })).rejects.toThrow('ENCRYPTION_KEY_MISSING');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it('rejects modified ciphertext instead of falling back to the environment token', async () => {
    await saveHappyScribeSettings({
      token: testToken, organizationId: '123456', mediaImportEnabled: false,
    });
    process.env.HAPPY_SCRIBE_API_TOKEN = 'SYNTHETIC_FALLBACK_TOKEN';
    const saved = store.get(TOKEN_KEY)!;
    const parts = saved.split('.');
    parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
    store.set(TOKEN_KEY, parts.join('.'));
    await expect(getHappyScribeSettings()).rejects.toThrow();
  });

  it('keeps VPS media proxy off without the independent deployment flag', async () => {
    await saveHappyScribeSettings({
      token: testToken, organizationId: '123456', mediaImportEnabled: true,
    });
    expect((await getHappyScribeSettings()).mediaImportEnabled).toBe(false);
    expect((await getHappyScribeSettingsStatus()).mediaImportEnabled).toBe(false);
    process.env.HAPPY_SCRIBE_MEDIA_PROXY_ENABLED = 'true';
    expect((await getHappyScribeSettings()).mediaImportEnabled).toBe(true);
    expect((await getHappyScribeSettingsStatus()).mediaImportEnabled).toBe(true);
  });

  it('rejects malformed organization IDs and preserves the existing token', async () => {
    await saveHappyScribeSettings({
      token: testToken, organizationId: '123456', mediaImportEnabled: false,
    });
    const previous = store.get(TOKEN_KEY);
    await expect(saveHappyScribeSettings({
      organizationId: 'not-a-number', mediaImportEnabled: false,
    })).rejects.toThrow('ORGANIZATION_INVALID');
    expect(store.get(TOKEN_KEY)).toBe(previous);
  });
  it('does not silently reactivate a server organization after the administrator clears it', async () => {
    process.env.HAPPY_SCRIBE_ORGANIZATION_ID = 'legacy-org-id';
    process.env.HAPPY_SCRIBE_API_TOKEN = 'SYNTHETIC_LEGACY_TOKEN';
    expect((await getHappyScribeSettings()).organizationId).toBe('legacy-org-id');
    await saveHappyScribeSettings({ organizationId: '', mediaImportEnabled: false });
    expect((await getHappyScribeSettings()).organizationId).toBe('');
    expect((await getHappyScribeSettingsStatus()).organizationId).toBe('');
  });

  it('preserves another admin\'s provider configuration when only editor defaults are updated', async () => {
    process.env.HAPPY_SCRIBE_MEDIA_PROXY_ENABLED = 'true';
    await saveHappyScribeSettings({
      token: testToken, organizationId: '123456', mediaImportEnabled: true,
      integrationEnabled: false,
    });
    const before = new Map(store);
    await saveHappyScribeSettings({ compactViewDefault: 'expanded' });
    expect(store.get(TOKEN_KEY)).toBe(before.get(TOKEN_KEY));
    expect(store.get('audio_studio_happyscribe_organization_id')).toBe('123456');
    expect(store.get('audio_studio_happyscribe_media_proxy')).toBe('true');
    expect(store.get('audio_studio_happyscribe_enabled')).toBe('false');
    expect((await getHappyScribeSettingsStatus()).compactViewDefault).toBe('expanded');
    expect((await getHappyScribeSettings()).token).toBe('');
  });

  it('allows explicit clearing of the organization and disabling of MP3 while leaving token alone', async () => {
    await saveHappyScribeSettings({
      token: testToken, organizationId: '123456', mediaImportEnabled: true,
    });
    const encrypted = store.get(TOKEN_KEY);
    await saveHappyScribeSettings({ organizationId: '', mediaImportEnabled: false });
    expect(store.get(TOKEN_KEY)).toBe(encrypted);
    expect((await getHappyScribeSettings()).organizationId).toBe('');
    expect(store.get('audio_studio_happyscribe_media_proxy')).toBe('false');
  });

  it('rejects invalid MP3 preference without starting a transaction', async () => {
    await expect(saveHappyScribeSettings({
      mediaImportEnabled: 'maybe' as unknown as boolean,
    })).rejects.toThrow('MEDIA_PREFERENCE_INVALID');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects replacing and removing the API key in the same operation without writing', async () => {
    await expect(saveHappyScribeSettings({
      token: testToken, removeToken: true,
      organizationId: '123456', mediaImportEnabled: false,
    })).rejects.toThrow('TOKEN_OPERATION_CONFLICT');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it('persists allowed Audio Studio defaults and supplies safe defaults when absent', async () => {
    expect(await getAudioStudioEditorPreferences()).toEqual({
      excludeInterpreterByDefault: true, compactViewDefault: 'auto', protocolLanguageDefault: 'en',
    });
    await saveHappyScribeSettings({
      organizationId: '123456', mediaImportEnabled: false,
      excludeInterpreterByDefault: false, compactViewDefault: 'compact', protocolLanguageDefault: 'es',
    });
    expect(await getAudioStudioEditorPreferences()).toEqual({
      excludeInterpreterByDefault: false, compactViewDefault: 'compact', protocolLanguageDefault: 'es',
    });
    expect(await getHappyScribeSettingsStatus()).toMatchObject({
      excludeInterpreterByDefault: false, compactViewDefault: 'compact', protocolLanguageDefault: 'es',
    });
    await saveHappyScribeSettings({ organizationId: '123456', mediaImportEnabled: false });
    expect(await getAudioStudioEditorPreferences()).toEqual({
      excludeInterpreterByDefault: false, compactViewDefault: 'compact', protocolLanguageDefault: 'es',
    });
  });

  it('rejects invalid Audio Studio editor mode before database writes', async () => {
    await expect(saveHappyScribeSettings({
      organizationId: '123456', mediaImportEnabled: false,
      compactViewDefault: 'unknown' as 'auto',
    })).rejects.toThrow('COMPACT_MODE_INVALID');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects unsupported protocol language before any database transaction', async () => {
    await expect(saveHappyScribeSettings({
      organizationId: '123456', mediaImportEnabled: false,
      protocolLanguageDefault: 'fr' as 'en',
    })).rejects.toThrow('PROTOCOL_LANGUAGE_INVALID');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('marks an encrypted token as unusable when the runtime decryption key is missing', async () => {
    await saveHappyScribeSettings({
      token: testToken, organizationId: '123456', mediaImportEnabled: false,
    });
    delete process.env.AUDIO_STUDIO_ENCRYPTION_KEY;
    const status = await getHappyScribeSettingsStatus();
    expect(status.hasToken).toBe(true);
    expect(status.credentialUsable).toBe(false);
    expect(JSON.stringify(status)).not.toContain(testToken);
  });

});
