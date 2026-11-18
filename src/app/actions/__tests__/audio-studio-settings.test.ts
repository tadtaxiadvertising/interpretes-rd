// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/actions', () => ({ validateAction: vi.fn() }));
vi.mock('@/lib/roleplay/happyscribe-settings', () => ({
  saveHappyScribeSettings: vi.fn(),
  getHappyScribeSettingsStatus: vi.fn(),
  getAudioStudioEditorPreferences: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { validateAction } from '@/lib/auth/actions';
import { saveHappyScribeSettings, getHappyScribeSettingsStatus, getAudioStudioEditorPreferences } from '@/lib/roleplay/happyscribe-settings';
import { revalidatePath } from 'next/cache';
import { inspectAudioStudioSettings, readAudioStudioEditorPreferences, saveAudioStudioSettings } from '../audio-studio-settings';

const syntheticAdmin = { user: { userId: 'test-admin', role: 'admin' } };
const fakeToken = 'SYNTHETIC_NOT_A_PROVIDER_TOKEN_12345';
const settingsForm = () => {
  const form = new FormData();
  form.set('token', fakeToken);
  form.set('organizationId', '123456');
  form.set('mediaImportEnabled', 'on');
  return form;
};

describe('Audio Studio admin settings: consent, privacy and post-commit status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateAction).mockResolvedValue(syntheticAdmin as never);
    vi.mocked(saveHappyScribeSettings).mockResolvedValue(undefined);
  });

  it('does not call the settings store without admin rights', async () => {
    vi.mocked(validateAction).mockResolvedValue({ error: 'Access denied', code: 'UNAUTHORIZED' } as never);
    const result = await saveAudioStudioSettings(settingsForm());
    expect(result).toEqual({ success: false, message: 'No autorizado.' });
    expect(saveHappyScribeSettings).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    await expect(inspectAudioStudioSettings()).rejects.toThrow('Forbidden');
    expect(getHappyScribeSettingsStatus).not.toHaveBeenCalled();
  });

  it('reports a committed save as successful even when cache revalidation fails', async () => {
    vi.mocked(revalidatePath).mockImplementationOnce(() => {
      throw new Error('PRIVATE_REFRESH_TOKEN');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await saveAudioStudioSettings(settingsForm());
      expect(result.success).toBe(true);
      expect(result.message).not.toContain(fakeToken);
      expect(saveHappyScribeSettings).toHaveBeenCalledExactlyOnceWith({
        token: fakeToken, organizationId: '123456',
        mediaImportEnabled: true, removeToken: false, updatedBy: 'test-admin',
      });
      expect(revalidatePath).toHaveBeenCalledWith('/admin/roleplays/settings');
      expect(warn).toHaveBeenCalledWith('[Audio Studio settings] Saved; cache refresh failed');
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_REFRESH_TOKEN');
      expect(JSON.stringify(warn.mock.calls)).not.toContain(fakeToken);
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('fails closed when encryption is missing, without echoing a credential', async () => {
    vi.mocked(saveHappyScribeSettings).mockRejectedValueOnce(new Error('ENCRYPTION_KEY_MISSING'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await saveAudioStudioSettings(settingsForm());
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/AUDIO_STUDIO_ENCRYPTION_KEY/);
      expect(result.message).not.toContain(fakeToken);
      expect(error).toHaveBeenCalledWith('[Audio Studio settings]', 'Error');
      expect(JSON.stringify(error.mock.calls)).not.toContain(fakeToken);
      expect(revalidatePath).not.toHaveBeenCalled();
    } finally { error.mockRestore(); }
  });

  it('never returns stored raw tokens when inspecting settings', async () => {
    const safeStatus = {
      hasToken: true, credentialUsable: true, environmentFallbackAvailable: false,
      tokenSource: 'panel', organizationId: '123456',
      mediaImportEnabled: false, proxyAvailable: false, encryptionReady: true,
      excludeInterpreterByDefault: true,
      compactViewDefault: 'auto' as const, protocolLanguageDefault: 'en' as const,
    };
    vi.mocked(getHappyScribeSettingsStatus).mockResolvedValueOnce(safeStatus);
    expect(await inspectAudioStudioSettings()).toEqual(safeStatus);
    expect(getHappyScribeSettingsStatus).toHaveBeenCalledOnce();
  });
  it('allows only admin roles to read editor defaults, without exposing keys', async () => {
    const preferences = {
      excludeInterpreterByDefault: false, compactViewDefault: 'compact' as const,
      protocolLanguageDefault: 'es' as const,
    };
    vi.mocked(getAudioStudioEditorPreferences).mockResolvedValueOnce(preferences);
    expect(await readAudioStudioEditorPreferences()).toEqual(preferences);
    vi.mocked(validateAction).mockResolvedValueOnce({ error: 'Access denied', code: 'UNAUTHORIZED' } as never);
    await expect(readAudioStudioEditorPreferences()).rejects.toThrow('Forbidden');
  });

  it('validates editor preference fields before changing the system configuration', async () => {
    const form = settingsForm();
    form.set('compactViewDefault', 'invalid');
    const result = await saveAudioStudioSettings(form);
    expect(result.success).toBe(false);
    expect(saveHappyScribeSettings).not.toHaveBeenCalled();
  });

  it('rejects unsupported protocol language and accepts an explicit Spanish default', async () => {
    const invalid = settingsForm();
    invalid.set('protocolLanguageDefault', 'fr');
    expect((await saveAudioStudioSettings(invalid)).success).toBe(false);
    expect(saveHappyScribeSettings).not.toHaveBeenCalled();

    const valid = settingsForm();
    valid.set('protocolLanguageDefault', 'es');
    expect((await saveAudioStudioSettings(valid)).success).toBe(true);
    expect(saveHappyScribeSettings).toHaveBeenCalledExactlyOnceWith({
      token: fakeToken, organizationId: '123456', mediaImportEnabled: true,
      removeToken: false, updatedBy: 'test-admin',
      protocolLanguageDefault: 'es',
    });
  });


  it('validates and persists an explicit disable without removing the API key', async () => {
    const invalid = settingsForm();
    invalid.set('integrationEnabled', 'maybe');
    expect((await saveAudioStudioSettings(invalid)).success).toBe(false);
    expect(saveHappyScribeSettings).not.toHaveBeenCalled();
    const valid = settingsForm();
    valid.delete('token');
    valid.set('token', '');
    valid.set('integrationEnabled', 'false');
    expect((await saveAudioStudioSettings(valid)).success).toBe(true);
    expect(saveHappyScribeSettings).toHaveBeenCalledWith({
      token: '', organizationId: '123456', mediaImportEnabled: true,
      integrationEnabled: false, removeToken: false, updatedBy: 'test-admin',
    });
  });

  it('persists explicit defaults alongside the provider settings', async () => {
    const form = settingsForm();
    form.set('excludeInterpreterByDefault', 'false');
    form.set('compactViewDefault', 'expanded');
    expect((await saveAudioStudioSettings(form)).success).toBe(true);
    expect(saveHappyScribeSettings).toHaveBeenCalledExactlyOnceWith({
      token: fakeToken, organizationId: '123456', mediaImportEnabled: true,
      removeToken: false, updatedBy: 'test-admin', excludeInterpreterByDefault: false, compactViewDefault: 'expanded',
    });
  });

});
