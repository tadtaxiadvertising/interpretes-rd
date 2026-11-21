import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  validateAction: vi.fn(),
  saveHappyScribeSettings: vi.fn(),
  revalidatePath: vi.fn(),
  safeServerErrorCategory: vi.fn(() => 'Error'),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/auth/actions', () => ({ validateAction: mocks.validateAction }));
vi.mock('@/lib/roleplay/happyscribe-settings', () => ({
  saveHappyScribeSettings: mocks.saveHappyScribeSettings,
  getHappyScribeSettingsStatus: vi.fn(),
  getAudioStudioEditorPreferences: vi.fn(),
}));
vi.mock('@/lib/security/safe-server-error', () => ({
  safeServerErrorCategory: mocks.safeServerErrorCategory,
}));

import { saveAudioStudioSettings } from './audio-studio-settings';

function settingsForm() {
  const form = new FormData();
  form.set('expectedRevision', 'a'.repeat(64));
  form.set('token', '');
  form.set('compactViewDefault', 'compact');
  return form;
}

describe('Audio Studio settings: safe classified save errors', () => {
  let log: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateAction.mockResolvedValue({ user: { userId: 'admin-synthetic' } });
    mocks.saveHappyScribeSettings.mockResolvedValue(undefined);
    log = vi.spyOn(console, 'error').mockImplementation(() => {});
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    log.mockRestore();
    warn.mockRestore();
  });

  it('returns the recovery instruction without logging an expected missing encryption key', async () => {
    mocks.saveHappyScribeSettings.mockRejectedValueOnce(new Error('ENCRYPTION_KEY_MISSING'));
    const result = await saveAudioStudioSettings(settingsForm());
    expect(result.success).toBe(false);
    expect(result.message).toContain('servicio Next.js');
    expect(result.message).toContain('clave original');
    expect(log).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('separately classifies a missing database column without exposing Prisma details', async () => {
    mocks.saveHappyScribeSettings.mockRejectedValueOnce({
      code: 'P2022', message: 'SYNTHETIC_PRIVATE_DATABASE_URL',
    });
    const result = await saveAudioStudioSettings(settingsForm());
    expect(result.success).toBe(false);
    expect(result.message).toContain('estructura de configuración');
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC_PRIVATE_DATABASE_URL');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SYNTHETIC_PRIVATE_DATABASE_URL');
    expect(log).not.toHaveBeenCalled();
  });

  it('distinguishes database connectivity from an encryption failure', async () => {
    mocks.saveHappyScribeSettings.mockRejectedValueOnce({ code: 'P1001', message: 'SYNTHETIC_SECRET' });
    const result = await saveAudioStudioSettings(settingsForm());
    expect(result.message).toContain('PostgreSQL');
    expect(result.message).not.toContain('AUDIO_STUDIO_ENCRYPTION_KEY');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SYNTHETIC_SECRET');
  });

  it('does not leak arbitrary errors to browser or server logs', async () => {
    mocks.saveHappyScribeSettings.mockRejectedValueOnce(
      new Error('SYNTHETIC_PROVIDER_API_TOKEN_AND_DATABASE_PASSWORD'),
    );
    const result = await saveAudioStudioSettings(settingsForm());
    expect(result.success).toBe(false);
    expect(result.message).toContain('No se pudieron guardar');
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC_PROVIDER_API_TOKEN');
    expect(JSON.stringify(log.mock.calls)).not.toContain('SYNTHETIC_PROVIDER_API_TOKEN');
    expect(log).toHaveBeenCalledWith('[Audio Studio settings] Unexpected save failure:', 'Error');
  });

  it('preserves optimistic concurrency protections', async () => {
    mocks.saveHappyScribeSettings.mockRejectedValueOnce(new Error('SETTINGS_CONFLICT'));
    const result = await saveAudioStudioSettings(settingsForm());
    expect(result.conflict).toBe(true);
    expect(result.success).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });

  it('does not write settings for a non-admin', async () => {
    mocks.validateAction.mockResolvedValueOnce({ error: 'Forbidden' });
    expect((await saveAudioStudioSettings(settingsForm())).success).toBe(false);
    expect(mocks.saveHappyScribeSettings).not.toHaveBeenCalled();
  });
});
