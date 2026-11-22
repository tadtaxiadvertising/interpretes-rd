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
  it('copies only safe server status even when an API token is typed but unsaved', async () => {
    const clipboardPrevious = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText },
    });
    try {
      render(<AudioStudioSettingsForm initial={initial} />);
      fireEvent.change(screen.getByLabelText('Clave API de HappyScribe'), {
        target: { value: 'SYNTHETIC_UNSAVED_API_SECRET' },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Copiar diagnóstico seguro' }));
      });
      expect(writeText).toHaveBeenCalledOnce();
      const copied = vi.mocked(writeText).mock.calls[0][0] as string;
      expect(copied).toContain('Intérpretes RD');
      expect(copied).toContain('Cifrado disponible en Next.js: sí');
      expect(copied).not.toContain('SYNTHETIC_UNSAVED_API_SECRET');
      expect(copied).not.toContain(initial.organizationId);
      expect(copied).not.toContain(initial.revision);
      expect(screen.getByText(/Diagnóstico seguro copiado/)).toBeTruthy();
      expect((screen.getByLabelText('Clave API de HappyScribe') as HTMLInputElement).value)
        .toBe('SYNTHETIC_UNSAVED_API_SECRET');
      expect(saveAudioStudioSettings).not.toHaveBeenCalled();
    } finally {
      if (clipboardPrevious) Object.defineProperty(navigator, 'clipboard', clipboardPrevious);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });


  it('checks the deployed Next.js SHA without submitting unsaved HappyScribe credentials', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      buildId: 'A'.repeat(40),
      buildTimestamp: '2026-11-22T06:00:00Z',
    }));
    vi.stubGlobal('fetch', fetcher);
    try {
      render(<AudioStudioSettingsForm initial={initial} />);
      fireEvent.change(screen.getByLabelText('Clave API de HappyScribe'), {
        target: { value: 'SYNTHETIC_UNSAVED_PROVIDER_TOKEN' },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Verificar versión de Next.js (solo lectura)' }));
      });
      expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/version', {
        method: 'GET', credentials: 'same-origin', cache: 'no-store',
      });
      expect(screen.getByText('a'.repeat(40))).toBeTruthy();
      expect((screen.getByLabelText('Clave API de HappyScribe') as HTMLInputElement).value)
        .toBe('SYNTHETIC_UNSAVED_PROVIDER_TOKEN');
      expect(saveAudioStudioSettings).not.toHaveBeenCalled();
      expect(inspectAudioStudioSettings).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not echo malformed release metadata or claim the server runs main', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      buildId: 'SYNTHETIC_PRIVATE_UNVERIFIED_VALUE',
      buildTimestamp: 'unsafe',
    }));
    vi.stubGlobal('fetch', fetcher);
    try {
      render(<AudioStudioSettingsForm initial={initial} />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Verificar versión de Next.js (solo lectura)' }));
      });
      expect(screen.getByRole('status').textContent).toContain('no informa un SHA verificable');
      expect(screen.getByRole('status').textContent).not.toContain('SYNTHETIC_PRIVATE_UNVERIFIED_VALUE');
      expect(screen.getByRole('status').textContent).not.toContain('unsafe');
      expect(saveAudioStudioSettings).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reports an unreachable version endpoint without modifying saved settings', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('SYNTHETIC_SECRET_SHOULD_NOT_BE_SHOWN'));
    vi.stubGlobal('fetch', fetcher);
    try {
      render(<AudioStudioSettingsForm initial={initial} />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Verificar versión de Next.js (solo lectura)' }));
      });
      expect(screen.getByText(/No se pudo consultar la versión de Next.js/)).toBeTruthy();
      expect(screen.queryByText(/SYNTHETIC_SECRET_SHOULD_NOT_BE_SHOWN/)).toBeNull();
      expect(saveAudioStudioSettings).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps a failed configuration save visible after copying the safe diagnostic', async () => {
    vi.mocked(saveAudioStudioSettings).mockResolvedValueOnce({
      success: false,
      message: 'Falta AUDIO_STUDIO_ENCRYPTION_KEY en Next.js.',
    });
    const previous = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText },
    });
    try {
      render(<AudioStudioSettingsForm initial={initial} />);
      fireEvent.change(screen.getByLabelText('Vista inicial de intervenciones'), {
        target: { value: 'expanded' },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Guardar configuración' }));
      });
      expect(screen.getByText(/Falta AUDIO_STUDIO_ENCRYPTION_KEY/)).toBeTruthy();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Copiar diagnóstico seguro' }));
      });
      expect(writeText).toHaveBeenCalledOnce();
      expect(screen.getByText(/Diagnóstico seguro copiado/)).toBeTruthy();
      // Copying a health report must not replace the actual failure.
      expect(screen.getByText(/Falta AUDIO_STUDIO_ENCRYPTION_KEY/)).toBeTruthy();
      expect(saveAudioStudioSettings).toHaveBeenCalledOnce();
    } finally {
      if (previous) Object.defineProperty(navigator, 'clipboard', previous);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('disables sharing stale status until an administrator resolves a save conflict', async () => {
    vi.mocked(saveAudioStudioSettings).mockResolvedValueOnce({
      success: false, conflict: true,
      message: 'Otro administrador modificó estos ajustes.',
    });
    const previous = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText },
    });
    try {
      render(<AudioStudioSettingsForm initial={initial} />);
      fireEvent.change(screen.getByLabelText('Vista inicial de intervenciones'), {
        target: { value: 'expanded' },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Guardar configuración' }));
      });
      const copy = screen.getByRole('button', { name: 'Copiar diagnóstico seguro' }) as HTMLButtonElement;
      expect(copy.disabled).toBe(true);
      fireEvent.click(copy);
      expect(writeText).not.toHaveBeenCalled();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', {
          name: 'Descartar mis cambios y cargar ajustes actuales',
        }));
      });
      expect(copy.disabled).toBe(false);
      await act(async () => { fireEvent.click(copy); });
      expect(writeText).toHaveBeenCalledOnce();
    } finally {
      if (previous) Object.defineProperty(navigator, 'clipboard', previous);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('rechecks a newly configured encryption key without losing the unsaved API token', async () => {
    const missingKey = {
      ...initial, tokenSource: 'ninguna', hasToken: false,
      credentialUsable: false, encryptionReady: false,
    };
    vi.mocked(inspectAudioStudioSettings).mockResolvedValueOnce({
      ...missingKey, encryptionReady: true,
    });
    render(<AudioStudioSettingsForm initial={missingKey} />);
    fireEvent.change(screen.getByLabelText('Clave API de HappyScribe'), {
      target: { value: 'SYNTHETIC_UNSAVED_NEW_TOKEN' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Guardar configuración' }));
    });
    expect(saveAudioStudioSettings).not.toHaveBeenCalled();
    expect(screen.getByText(/No se guardó la clave API/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Recomprobar cifrado en servidor' }));
    });
    expect(inspectAudioStudioSettings).toHaveBeenCalledOnce();
    expect(screen.getByText(/El cifrado ya está disponible en Next.js/)).toBeTruthy();
    expect(screen.queryByText(/no está configurada correctamente en el servicio Next.js/)).toBeNull();
    expect((screen.getByLabelText('Clave API de HappyScribe') as HTMLInputElement).value)
      .toBe('SYNTHETIC_UNSAVED_NEW_TOKEN');
    expect((screen.getByRole('button', { name: 'Guardar configuración' }) as HTMLButtonElement).disabled)
      .toBe(false);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Guardar configuración' }));
    });
    expect(saveAudioStudioSettings).toHaveBeenCalledOnce();
    const submitted = vi.mocked(saveAudioStudioSettings).mock.calls[0][0];
    expect(submitted.get('token')).toBe('SYNTHETIC_UNSAVED_NEW_TOKEN');
    expect(submitted.get('expectedRevision')).toBe(initial.revision);
  });

  it('allows recovery with the original key to unblock an unreadable panel token', async () => {
    const unreadable = { ...initial, credentialUsable: false, encryptionReady: false };
    vi.mocked(inspectAudioStudioSettings).mockResolvedValueOnce({
      ...unreadable, credentialUsable: true, encryptionReady: true,
    });
    render(<AudioStudioSettingsForm initial={unreadable} />);
    fireEvent.change(screen.getByLabelText('Clave API de HappyScribe'), {
      target: { value: 'SYNTHETIC_PENDING_REPLACEMENT' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Guardar configuración' }));
    });
    expect(saveAudioStudioSettings).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Recomprobar cifrado en servidor' }));
    });
    expect((screen.getByLabelText('Clave API de HappyScribe') as HTMLInputElement).value)
      .toBe('SYNTHETIC_PENDING_REPLACEMENT');
    expect(screen.getByText(/El cifrado ya está disponible en Next.js/)).toBeTruthy();
    expect((screen.getByRole('checkbox', {
      name: /Borrar la clave guardada en el panel/,
    }) as HTMLInputElement).disabled).toBe(false);
  });

  it('does not claim recovery when a valid-format key cannot decrypt the existing panel token', async () => {
    const unreadable = { ...initial, encryptionReady: false, credentialUsable: false };
    vi.mocked(inspectAudioStudioSettings).mockResolvedValueOnce({
      ...unreadable, encryptionReady: true, credentialUsable: false,
    });
    render(<AudioStudioSettingsForm initial={unreadable} />);
    fireEvent.change(screen.getByLabelText('Clave API de HappyScribe'), {
      target: { value: 'SYNTHETIC_UNSAVED_REPLACEMENT' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Recomprobar cifrado en servidor' }));
    });
    expect(inspectAudioStudioSettings).toHaveBeenCalledOnce();
    expect(screen.getByText(/La clave tiene formato válido, pero la credencial guardada todavía no se puede descifrar/)).toBeTruthy();
    expect(screen.queryByText(/El cifrado ya está disponible en Next.js/)).toBeNull();
    expect(screen.getByText(/La clave de cifrado tiene formato válido, pero la credencial guardada no se puede descifrar/)).toBeTruthy();
    expect((screen.getByLabelText('Clave API de HappyScribe') as HTMLInputElement).value)
      .toBe('SYNTHETIC_UNSAVED_REPLACEMENT');
    expect(saveAudioStudioSettings).not.toHaveBeenCalled();
  });

  it('preserves the entire draft and blocks stale saves if the server revision changed', async () => {
    vi.mocked(inspectAudioStudioSettings).mockResolvedValueOnce({
      ...initial, revision: 'c'.repeat(64), encryptionReady: false,
    });
    render(<AudioStudioSettingsForm initial={initial} />);
    fireEvent.change(screen.getByLabelText('Clave API de HappyScribe'), {
      target: { value: 'SYNTHETIC_PENDING_SECRET' },
    });
    fireEvent.change(screen.getByLabelText('Vista inicial de intervenciones'), {
      target: { value: 'compact' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Recomprobar cifrado en servidor' }));
    });
    expect(screen.getByText(/Los ajustes del servidor cambiaron/)).toBeTruthy();
    expect((screen.getByLabelText('Clave API de HappyScribe') as HTMLInputElement).value)
      .toBe('SYNTHETIC_PENDING_SECRET');
    expect((screen.getByLabelText('Vista inicial de intervenciones') as HTMLSelectElement).value)
      .toBe('compact');
    expect((screen.getByRole('button', { name: 'Guardar configuración' }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect((screen.getByRole('button', { name: 'Recomprobar cifrado en servidor' }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect(saveAudioStudioSettings).not.toHaveBeenCalled();
  });

  it('does not clear the draft if checking the encryption status fails', async () => {
    vi.mocked(inspectAudioStudioSettings).mockRejectedValueOnce(new Error('synthetic offline'));
    render(<AudioStudioSettingsForm initial={{
      ...initial, encryptionReady: false,
    }} />);
    fireEvent.change(screen.getByLabelText('Clave API de HappyScribe'), {
      target: { value: 'SYNTHETIC_UNSAVED_DRAFT' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Recomprobar cifrado en servidor' }));
    });
    expect(screen.getByText(/No fue posible consultar el estado actualizado/)).toBeTruthy();
    expect((screen.getByLabelText('Clave API de HappyScribe') as HTMLInputElement).value)
      .toBe('SYNTHETIC_UNSAVED_DRAFT');
    expect(saveAudioStudioSettings).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Recomprobar cifrado en servidor' }) as HTMLButtonElement).disabled)
      .toBe(false);
  });

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
