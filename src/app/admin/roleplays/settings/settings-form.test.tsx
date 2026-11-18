// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inspectAudioStudioSettings, saveAudioStudioSettings } from '@/app/actions/audio-studio-settings';
import AudioStudioSettingsForm from './settings-form';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    <a href={href}>{children}</a>,
}));
vi.mock('@/app/actions/audio-studio-settings', () => ({
  inspectAudioStudioSettings: vi.fn(),
  saveAudioStudioSettings: vi.fn(),
}));

const initial = {
  revision: 'a'.repeat(64),
  integrationEnabled: true,
  hasToken: true,
  credentialUsable: true,
  environmentFallbackAvailable: false,
  tokenSource: 'panel',
  organizationId: '123456',
  mediaImportEnabled: true,
  proxyAvailable: true,
  encryptionReady: true,
  excludeInterpreterByDefault: true,
  compactViewDefault: 'auto' as const,
  protocolLanguageDefault: 'es' as const,
};

beforeEach(() => {
  vi.mocked(saveAudioStudioSettings).mockResolvedValue({
    success: true, message: 'Configuración guardada.',
  });
  vi.mocked(inspectAudioStudioSettings).mockResolvedValue(initial);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('Audio Studio admin partial settings payload', () => {
  it('does not resubmit untouched organization, MP3, or connection state', async () => {
    render(<AudioStudioSettingsForm initial={initial} />);
    fireEvent.change(screen.getByLabelText('Vista inicial de intervenciones'), {
      target: { value: 'expanded' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Guardar configuración' }));
    });
    expect(saveAudioStudioSettings).toHaveBeenCalledOnce();
    const submitted = vi.mocked(saveAudioStudioSettings).mock.calls[0][0];
    expect(submitted.get('compactViewDefault')).toBe('expanded');
    expect(submitted.get('expectedRevision')).toBe(initial.revision);
    expect(submitted.get('organizationId')).toBeNull();
    expect(submitted.get('mediaImportEnabled')).toBeNull();
    expect(submitted.get('integrationEnabled')).toBeNull();
  });

  it('sends explicit provider disablement without resubmitting untouched settings', async () => {
    render(<AudioStudioSettingsForm initial={initial} />);
    fireEvent.click(screen.getByRole('checkbox', {
      name: /Habilitar conexión con HappyScribe/,
    }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Guardar configuración' }));
    });
    const submitted = vi.mocked(saveAudioStudioSettings).mock.calls[0][0];
    expect(submitted.get('integrationEnabled')).toBe('false');
    expect(submitted.get('expectedRevision')).toBe(initial.revision);
    expect(submitted.get('organizationId')).toBeNull();
    expect(submitted.get('mediaImportEnabled')).toBeNull();
    expect(submitted.get('token')).toBe('');
  });
});
