// @vitest-environment jsdom
import type { MouseEventHandler, ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inspectAudioStudioSettings, saveAudioStudioSettings } from '@/app/actions/audio-studio-settings';
import AudioStudioSettingsForm from './settings-form';

vi.mock('next/link', () => ({
  default: ({ href, children, onClick }: { href: string; children: ReactNode; onClick?: MouseEventHandler<HTMLAnchorElement> }) =>
    <a href={href} onClick={onClick}>{children}</a>,
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
  it('does not save unchanged settings or report false success while HappyScribe is unconfigured', async () => {
    render(<AudioStudioSettingsForm initial={{
      ...initial, tokenSource: 'ninguna', hasToken: false, credentialUsable: false,
      encryptionReady: false,
    }} />);
    const save = screen.getByRole('button', { name: 'Guardar configuración' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    const form = save.closest('form') as HTMLFormElement;
    await act(async () => {
      // A synthetic form submission must obey the no-op guard too.
      fireEvent.submit(form);
    });
    expect(saveAudioStudioSettings).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Vista inicial de intervenciones'), {
      target: { value: 'compact' },
    });
    expect(save.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(save);
    });
    expect(saveAudioStudioSettings).toHaveBeenCalledOnce();
    expect(vi.mocked(saveAudioStudioSettings).mock.calls[0][0].get('compactViewDefault')).toBe('compact');
  });

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
    // After a successful explicit reload, there is no unsaved change to save.
    expect(saveButton.disabled).toBe(true);
    expect((screen.getByLabelText('ID de organización') as HTMLInputElement).value).toBe('654321');
    expect((screen.getByLabelText('Clave API de HappyScribe') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Vista inicial de intervenciones') as HTMLSelectElement).value).toBe('auto');
    fireEvent.change(screen.getByLabelText('Vista inicial de intervenciones'), {
      target: { value: 'expanded' },
    });
    expect(saveButton.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(saveButton);
    });
    expect(vi.mocked(saveAudioStudioSettings).mock.calls[1][0].get('expectedRevision')).toBe(newer.revision);
  });

  it('blocks an unsafe repeat when the settings action fails after a potentially committed save', async () => {
    vi.mocked(saveAudioStudioSettings).mockRejectedValueOnce(new Error('synthetic transport failed'));
    const latest = { ...initial, revision: 'd'.repeat(64), organizationId: '789123' };
    vi.mocked(inspectAudioStudioSettings).mockResolvedValueOnce(latest);
    render(<AudioStudioSettingsForm initial={initial} />);
    fireEvent.change(screen.getByLabelText('Clave API de HappyScribe'), {
      target: { value: 'SYNTHETIC_UNSAVED_SECRET' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Guardar configuración' }));
    });
    expect(screen.getByText(/No se pudo confirmar el guardado/)).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Guardar configuración' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect((screen.getByLabelText('Clave API de HappyScribe') as HTMLInputElement).value)
      .toBe('SYNTHETIC_UNSAVED_SECRET');
    expect(saveAudioStudioSettings).toHaveBeenCalledOnce();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Descartar mis cambios y cargar ajustes actuales' }));
    });
    // The ambiguous save was resolved by fetching the latest revision. A
    // clean form stays disabled until the admin makes a new change.
    expect(save.disabled).toBe(true);
    expect((screen.getByLabelText('Clave API de HappyScribe') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('ID de organización') as HTMLInputElement).value).toBe('789123');
    fireEvent.change(screen.getByLabelText('Vista inicial de intervenciones'), {
      target: { value: 'expanded' },
    });
    expect(save.disabled).toBe(false);
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
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Vista inicial de intervenciones'), {
      target: { value: 'expanded' },
    });
    expect(save.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(save);
    });
    expect(vi.mocked(saveAudioStudioSettings).mock.calls[1][0].get('expectedRevision')).toBe(updated.revision);
  });


  it('warns on a browser unload only while editor changes are unsaved', async () => {
    render(<AudioStudioSettingsForm initial={initial} />);
    const cleanExit = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanExit);
    expect(cleanExit.defaultPrevented).toBe(false);

    fireEvent.change(screen.getByLabelText('Vista inicial de intervenciones'), {
      target: { value: 'compact' },
    });
    const dirtyExit = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyExit);
    expect(dirtyExit.defaultPrevented).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Guardar configuración' }));
    });
    const afterSave = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(afterSave);
    expect(afterSave.defaultPrevented).toBe(false);
  });

  it('does not navigate to Audio Studio if the admin refuses to discard a draft', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      render(<AudioStudioSettingsForm initial={initial} />);
      fireEvent.change(screen.getByLabelText('Clave API de HappyScribe'), {
        target: { value: 'SYNTHETIC_UNSAVED_SECRET' },
      });
      const followed = fireEvent.click(screen.getByRole('link', { name: 'Abrir Audio Studio' }));
      expect(followed).toBe(false);
      expect(confirm).toHaveBeenCalledOnce();
      expect((screen.getByLabelText('Clave API de HappyScribe') as HTMLInputElement).value).toBe('SYNTHETIC_UNSAVED_SECRET');
    } finally {
      confirm.mockRestore();
    }
  });

  it('warns to restore the ORIGINAL encryption key when a panel token is already encrypted', () => {
    render(<AudioStudioSettingsForm initial={{
      ...initial, encryptionReady: false, credentialUsable: false,
    }} />);
    const warning = screen.getByRole('alert');
    expect(warning.textContent).toContain('Restaura la clave ORIGINAL');
    expect(warning.textContent).toContain('No generes otra clave');
    expect(warning.textContent).toContain('servicio Next.js');
    expect(warning.textContent).not.toContain('SYNTHETIC_UNSAVED_SECRET');
  });

  it('distinguishes a new panel setup from recovery of previously encrypted credentials', () => {
    render(<AudioStudioSettingsForm initial={{
      ...initial, tokenSource: 'ninguna', hasToken: false,
      encryptionReady: false, credentialUsable: false,
    }} />);
    const warning = screen.getByRole('alert');
    expect(warning.textContent).toContain('instalación nueva sin credenciales cifradas');
    expect(warning.textContent).not.toContain('Restaura la clave ORIGINAL');
    expect(screen.getByText(/No hay un token API utilizable/)).toBeTruthy();
  });

  it('does not diagnose a missing key when a saved token cannot be decrypted with a valid-format key', () => {
    render(<AudioStudioSettingsForm initial={{
      ...initial, encryptionReady: true, credentialUsable: false,
    }} />);
    const warning = screen.getByRole('alert');
    expect(warning.textContent).toContain('formato válido');
    expect(warning.textContent).toContain('clave ORIGINAL');
    expect(warning.textContent).not.toContain('no está configurada correctamente');
  });

  it('does not claim the encryption key is missing when a usable server token is present', () => {
    render(<AudioStudioSettingsForm initial={{
      ...initial, tokenSource: 'servidor', credentialUsable: true,
      encryptionReady: false,
    }} />);
    expect(screen.getByRole('alert').textContent).toContain('Para guardar una nueva clave API');
    expect(screen.queryByText(/Ya existe una credencial cifrada en el panel/)).toBeNull();
  });

  it('blocks both token replacement and deletion when a saved credential is unreadable', async () => {
    render(<AudioStudioSettingsForm initial={{
      ...initial, encryptionReady: true, credentialUsable: false,
    }} />);
    const removeToken = screen.getByRole('checkbox', { name: /Borrar la clave guardada en el panel/ }) as HTMLInputElement;
    expect(removeToken.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Clave API de HappyScribe'), {
      target: { value: 'SYNTHETIC_REPLACEMENT_TOKEN' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Guardar configuración' }));
    });
    expect(saveAudioStudioSettings).not.toHaveBeenCalled();
    expect(screen.getByText(/No se borró ni se reemplazó la credencial/)).toBeTruthy();
    expect((screen.getByLabelText('Clave API de HappyScribe') as HTMLInputElement).value)
      .toBe('SYNTHETIC_REPLACEMENT_TOKEN');
  });

  it('prioritizes recovery of existing ciphertext when its original encryption key is missing', async () => {
    render(<AudioStudioSettingsForm initial={{
      ...initial, encryptionReady: false, credentialUsable: false,
    }} />);
    fireEvent.change(screen.getByLabelText('Clave API de HappyScribe'), {
      target: { value: 'SYNTHETIC_UNSAVED_SECRET' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Guardar configuración' }));
    });
    expect(saveAudioStudioSettings).not.toHaveBeenCalled();
    expect(screen.getByText(/No se borró ni se reemplazó la credencial/)).toBeTruthy();
    expect((screen.getByLabelText('Clave API de HappyScribe') as HTMLInputElement).value)
      .toBe('SYNTHETIC_UNSAVED_SECRET');
  });

  it('requests an encryption key before the first token on a new installation', async () => {
    render(<AudioStudioSettingsForm initial={{
      ...initial, tokenSource: 'ninguna', hasToken: false,
      encryptionReady: false, credentialUsable: false,
    }} />);
    fireEvent.change(screen.getByLabelText('Clave API de HappyScribe'), {
      target: { value: 'SYNTHETIC_NEW_INSTALL_TOKEN' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Guardar configuración' }));
    });
    expect(saveAudioStudioSettings).not.toHaveBeenCalled();
    expect(screen.getByText(/No se guardó la clave API/)).toBeTruthy();
    expect((screen.getByLabelText('Clave API de HappyScribe') as HTMLInputElement).value)
      .toBe('SYNTHETIC_NEW_INSTALL_TOKEN');
  });

  it('allows changing an editor preference without a new token when the encryption key is missing', async () => {
    render(<AudioStudioSettingsForm initial={{
      ...initial, encryptionReady: false, credentialUsable: false,
    }} />);
    fireEvent.change(screen.getByLabelText('Vista inicial de intervenciones'), {
      target: { value: 'compact' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Guardar configuración' }));
    });
    expect(saveAudioStudioSettings).toHaveBeenCalledOnce();
    expect(vi.mocked(saveAudioStudioSettings).mock.calls[0][0].get('token')).toBe('');
  });

  it('navigates to Audio Studio without confirmation when nothing is edited', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      render(<AudioStudioSettingsForm initial={initial} />);
      const followed = fireEvent.click(screen.getByRole('link', { name: 'Abrir Audio Studio' }));
      expect(followed).toBe(true);
      expect(confirm).not.toHaveBeenCalled();
    } finally {
      confirm.mockRestore();
    }
  });

});
