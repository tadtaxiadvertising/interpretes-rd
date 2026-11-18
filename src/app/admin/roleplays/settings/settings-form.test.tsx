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
  it('blocks stale retries and only discards secret and edits after explicit reload', async () => {
    const newer = { ...initial, revision: 'b'.repeat(64), organizationId: '654321' };
    vi.mocked(saveAudioStudioSettings)
      .mockResolvedValueOnce({ success: false, conflict: true, message: 'Otro administrador modificó estos ajustes.' });
    vi.mocked(inspectAudioStudioSettings).mockResolvedValueOnce(newer);
    render(<AudioStudioSettingsForm initial={initial} />);
    fireEvent.change(screen.getByLabelText('Clave API de HappyScribe'), {
      target: { value: 'SYNTHETIC_UNSAVED_SECRET' },
    });
    fireEvent.change(screen.getByLabelText('Vista inicial de intervenciones'), {
      target: { value: 'compact' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Guardar configuración' }));
    });
    expect(saveAudioStudioSettings).toHaveBeenCalledOnce();
    const saveButton = screen.getByRole('button', { name: 'Guardar configuración' }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('Otro administrador');
    expect((screen.getByLabelText('Clave API de HappyScribe') as HTMLInputElement).value).toBe('SYNTHETIC_UNSAVED_SECRET');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Descartar mis cambios y cargar ajustes actuales' }));
    });
    expect(inspectAudioStudioSettings).toHaveBeenCalledOnce();
    expect(saveButton.disabled).toBe(false);
    expect((screen.getByLabelText('ID de organización') as HTMLInputElement).value).toBe('654321');
    expect((screen.getByLabelText('Clave API de HappyScribe') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Vista inicial de intervenciones') as HTMLSelectElement).value).toBe('auto');
    fireEvent.change(screen.getByLabelText('Vista inicial de intervenciones'), {
      target: { value: 'expanded' },
    });
    await act(async () => {
      fireEvent.click(saveButton);
    });
    expect(vi.mocked(saveAudioStudioSettings).mock.calls[1][0].get('expectedRevision')).toBe(newer.revision);
  });

  it('keeps local changes if the explicit conflict refresh fails', async () => {
    vi.mocked(saveAudioStudioSettings).mockResolvedValueOnce({
      success: false, conflict: true, message: 'Conflicto de edición.',
    });
    vi.mocked(inspectAudioStudioSettings).mockRejectedValueOnce(new Error('offline'));
    render(<AudioStudioSettingsForm initial={initial} />);
    fireEvent.change(screen.getByLabelText('Vista inicial de intervenciones'), {
      target: { value: 'expanded' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Guardar configuración' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Descartar mis cambios y cargar ajustes actuales' }));
    });
    expect((screen.getByLabelText('Vista inicial de intervenciones') as HTMLSelectElement).value).toBe('expanded');
    expect((screen.getByRole('button', { name: 'Guardar configuración' }) as HTMLButtonElement).disabled).toBe(true);
    expect(saveAudioStudioSettings).toHaveBeenCalledOnce();
  });

  it('does not allow a second save after commit if the new revision cannot be reloaded', async () => {
    const updated = { ...initial, revision: 'c'.repeat(64) };
    vi.mocked(inspectAudioStudioSettings)
      .mockRejectedValueOnce(new Error('synthetic unavailable database'))
      .mockResolvedValueOnce(updated);
    render(<AudioStudioSettingsForm initial={initial} />);
    fireEvent.change(screen.getByLabelText('Vista inicial de intervenciones'), {
      target: { value: 'compact' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Guardar configuración' }));
    });
    expect(saveAudioStudioSettings).toHaveBeenCalledOnce();
    expect(screen.getByText(/Configuración guardada. No se pudo actualizar/)).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Guardar configuración' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Descartar mis cambios y cargar ajustes actuales' }));
    });
    expect(save.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('Vista inicial de intervenciones'), {
      target: { value: 'expanded' },
    });
    await act(async () => {
      fireEvent.click(save);
    });
    expect(vi.mocked(saveAudioStudioSettings).mock.calls[1][0].get('expectedRevision')).toBe(updated.revision);
  });


});
