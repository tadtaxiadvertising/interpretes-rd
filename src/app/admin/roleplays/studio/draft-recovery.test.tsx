// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStudioDraft, sha256StudioAudio } from '@/lib/roleplay-studio/draft';
import { createLongMediaDraft, fingerprintLocalMedia } from '@/lib/roleplay-studio/long-media';
import RoleplayStudioPage from './page';

const hash = 'ab'.repeat(32);

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    <a href={href}>{children}</a>,
}));
vi.mock('@/lib/roleplay-studio/draft', async () => {
  const actual = await vi.importActual<typeof import('@/lib/roleplay-studio/draft')>(
    '@/lib/roleplay-studio/draft',
  );
  return { ...actual, sha256StudioAudio: vi.fn(async () => hash) };
});
vi.mock('@/lib/roleplay-studio/long-media', async () => {
  const actual = await vi.importActual<typeof import('@/lib/roleplay-studio/long-media')>(
    '@/lib/roleplay-studio/long-media',
  );
  return { ...actual, fingerprintLocalMedia: vi.fn(async () => hash) };
});

describe('Roleplay Studio editable project recovery', () => {
  beforeEach(() => {
    let id = 0;
    vi.stubGlobal('crypto', { randomUUID: () => 'draft-' + ++id });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:studio') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(sha256StudioAudio).mockResolvedValue(hash);
    vi.mocked(sha256StudioAudio).mockClear();
    vi.mocked(fingerprintLocalMedia).mockResolvedValue(hash);
    vi.mocked(fingerprintLocalMedia).mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function selectSource(filename = 'medical.mp3') {
    const { container } = render(<RoleplayStudioPage />);
    const upload = screen.getByLabelText(/Grabación original MP3/i);
    fireEvent.change(upload, { target: { files: [new File(['ID3'], filename, { type: 'audio/mpeg' })] } });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 90 });
    fireEvent.loadedMetadata(player);
    // These tests verify compatibility with the previous complete-SHA256
    // server ZIP project format. The production editor now defaults to a
    // local short-MP3 project, so opt into the legacy mode explicitly.
    fireEvent.click(screen.getByRole('radio', { name: /Servidor \(opcional\)/i }));
    return { upload, player };
  }

  function project(title = 'Paciente · 1 (ES)', sourceHash = hash) {
    const draft = createStudioDraft(3, sourceHash, [{
      title, start: 0, end: 10,
      scriptPrompt: 'Interpretar con fidelidad',
      responseLimit: 120, speakerRole: 'patient', language: 'es',
    }], 90);
    const file = new File(['project'], 'roleplay-studio-proyecto.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { configurable: true, value: async () => JSON.stringify(draft) });
    return file;
  }

  it('reopens a short MP3 as a local project without uploading or restoring captions', async () => {
    selectSource();
    fireEvent.click(screen.getByRole('radio', { name: /Local \(predeterminado\)/i }));
    const source = createLongMediaDraft(3, hash, [{
      title: 'Médico · local', start: 1.5, end: 5.5,
      scriptPrompt: 'Interpretar', responseLimit: 120,
      speakerRole: 'doctor', language: 'es',
    }], 90);
    const file = new File(['local project'], 'roleplay-studio-proyecto-largo.json', {
      type: 'application/json',
    });
    Object.defineProperty(file, 'text', {
      configurable: true, value: async () => JSON.stringify(source),
    });
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Abrir proyecto JSON de la grabación seleccionada/i), {
        target: { files: [file] },
      });
    });
    expect(screen.getByText(/Proyecto vinculado por tamaño, duración y huella parcial/i)).toBeTruthy();
    expect((screen.getByLabelText('Título') as HTMLInputElement).value).toBe('Médico · local');
    expect(screen.queryByText(/Transcripción de referencia · solo editor/i)).toBeNull();
    expect(vi.mocked(fingerprintLocalMedia)).toHaveBeenCalledOnce();
    expect(vi.mocked(sha256StudioAudio)).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('opens an older complete-SHA256 project without leaving local-first mode or uploading the MP3', async () => {
    selectSource();
    fireEvent.click(screen.getByRole('radio', { name: /Local \(predeterminado\)/i }));
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Abrir proyecto JSON de la grabación seleccionada/i), {
        target: { files: [project('Paciente · antiguo')] },
      });
    });
    expect(screen.getByText(/Proyecto verificado con SHA-256 completo y restaurado: 1 intervenciones/)).toBeTruthy();
    expect((screen.getByRole('radio', { name: /Local \(predeterminado\)/i }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Título') as HTMLInputElement).value).toBe('Paciente · antiguo');
    expect(vi.mocked(sha256StudioAudio)).toHaveBeenCalledOnce();
    expect(vi.mocked(fingerprintLocalMedia)).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('opens a sampled local project even when the MP3 server mode is selected', async () => {
    selectSource(); // Existing compatibility mode: server selected.
    const draft = createLongMediaDraft(3, hash, [{
      title: 'Doctor · sampled', start: 4, end: 6,
      scriptPrompt: '', responseLimit: 120,
      speakerRole: 'doctor', language: 'en',
    }], 90);
    const file = new File(['local project'], 'project.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', {
      configurable: true, value: async () => JSON.stringify(draft),
    });
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Abrir proyecto JSON de la grabación seleccionada/i), {
        target: { files: [file] },
      });
    });
    expect(screen.getByText(/Proyecto vinculado por tamaño, duración y huella parcial/)).toBeTruthy();
    expect((screen.getByLabelText('Título') as HTMLInputElement).value).toBe('Doctor · sampled');
    expect((screen.getByRole('radio', { name: /Servidor \(opcional\)/i }) as HTMLInputElement).checked).toBe(true);
    expect(vi.mocked(fingerprintLocalMedia)).toHaveBeenCalledOnce();
    expect(vi.mocked(sha256StudioAudio)).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('forces local export when opening v2, even after separating its cuts', async () => {
    selectSource(); // Simulate server explicitly enabled before opening.
    const compound = createLongMediaDraft(3, hash, [{
      title: 'Médico · compuesto', start: 0, end: 45,
      ranges: [{ start: 0, end: 10 }, { start: 40, end: 45 }],
      scriptPrompt: '', responseLimit: 120, speakerRole: 'doctor', language: 'en',
    }], 90);
    expect(compound.version).toBe(2);
    const file = new File(['v2 project'], 'project-v2.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', {
      configurable: true, value: async () => JSON.stringify(compound),
    });
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Abrir proyecto JSON de la grabación seleccionada/i), {
        target: { files: [file] },
      });
    });
    expect(screen.getByText(/Proyecto v2 restaurado/)).toBeTruthy();
    expect(screen.queryByRole('radio', { name: /Servidor \(opcional\)/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Separar cortes de intervención 1/ }));
    expect((screen.getByRole('radio', { name: /Local \(predeterminado\)/i }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: /Servidor \(opcional\)/i }) as HTMLInputElement).checked).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects an old complete-hash project for a long MP3 before allocating the whole source', async () => {
    const { player } = selectSource();
    Object.defineProperty(player, 'duration', { configurable: true, value: 7201 });
    fireEvent.loadedMetadata(player);
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Abrir proyecto JSON de la grabación seleccionada/i), {
        target: { files: [project('Legacy long')] },
      });
    });
    expect(screen.getByRole('alert').textContent).toMatch(/solo admite MP3 de hasta 15 MiB y 2 horas/);
    expect(vi.mocked(sha256StudioAudio)).not.toHaveBeenCalled();
    expect(vi.mocked(fingerprintLocalMedia)).not.toHaveBeenCalled();
    expect(screen.getByText(/Intervenciones \(0\/25\)/)).toBeTruthy();
  });

  it('rejects unknown project formats before hashing media or overwriting current edits', async () => {
    selectSource();
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/i }));
    const file = new File(['unsupported'], 'project.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', {
      configurable: true, value: async () => JSON.stringify({ format: 'different-product', version: 1 }),
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Abrir proyecto JSON de la grabación seleccionada/i), {
        target: { files: [file] },
      });
    });
    expect(screen.getByRole('alert').textContent).toMatch(/no es compatible/);
    expect((screen.getByLabelText('Título') as HTMLInputElement).value).toBe('Intervención 1');
    expect(window.confirm).not.toHaveBeenCalled();
    expect(vi.mocked(fingerprintLocalMedia)).not.toHaveBeenCalled();
    expect(vi.mocked(sha256StudioAudio)).not.toHaveBeenCalled();
  });

  it('restores verified segment metadata from a project without restoring private captions', async () => {
    selectSource();
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Abrir proyecto JSON de la grabación seleccionada/i), {
        target: { files: [project()] },
      });
    });
    expect(screen.getByText(/Proyecto verificado con SHA-256 completo y restaurado: 1 intervenciones/)).toBeTruthy();
    expect((screen.getByLabelText('Título') as HTMLInputElement).value).toBe('Paciente · 1 (ES)');
    expect(screen.getByDisplayValue('Interpretar con fidelidad')).toBeTruthy();
    expect(screen.queryByText(/Transcripción de referencia · solo editor/)).toBeNull();
  });

  it('keeps existing edits when the administrator declines a valid project replacement', async () => {
    selectSource();
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/i }));
    const originalTitle = screen.getByLabelText('Título') as HTMLInputElement;
    fireEvent.change(originalTitle, { target: { value: 'Edición sin guardar' } });
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Abrir proyecto JSON de la grabación seleccionada/i), {
        target: { files: [project('Nuevo borrador válido')] },
      });
    });
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(screen.getByText(/Importación cancelada/)).toBeTruthy();
    expect((screen.getByLabelText('Título') as HTMLInputElement).value).toBe('Edición sin guardar');
    expect(screen.getByText(/Intervenciones \\(1\\/25\\)/)).toBeTruthy();
    expect(screen.queryByDisplayValue('Nuevo borrador válido')).toBeNull();
    expect(screen.getByLabelText(/Abrir proyecto JSON de la grabación seleccionada/i)).not.toHaveProperty('disabled', true);
  });

  it('replaces current edits only after accepting a verified project', async () => {
    selectSource();
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/i }));
    const originalTitle = screen.getByLabelText('Título') as HTMLInputElement;
    fireEvent.change(originalTitle, { target: { value: 'Edición anterior' } });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Abrir proyecto JSON de la grabación seleccionada/i), {
        target: { files: [project('Borrador aprobado')] },
      });
    });
    expect(window.confirm).toHaveBeenCalledOnce();
    expect((screen.getByLabelText('Título') as HTMLInputElement).value).toBe('Borrador aprobado');
    expect(screen.queryByDisplayValue('Edición anterior')).toBeNull();
  });

  it('never changes a prior server choice when rejecting a verified compound v2 draft', async () => {
    selectSource();
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/i }));
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    const source = createLongMediaDraft(3, hash, [{
      title: 'Médico compuesto', start: 0, end: 45,
      ranges: [{ start: 0, end: 10 }, { start: 40, end: 45 }],
      scriptPrompt: '', responseLimit: 120, speakerRole: 'doctor', language: 'en',
    }], 90);
    const file = new File(['v2 project'], 'project-v2.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { configurable: true, value: async () => JSON.stringify(source) });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Abrir proyecto JSON de la grabación seleccionada/i), {
        target: { files: [file] },
      });
    });
    expect(window.confirm).toHaveBeenCalledOnce();
    expect((screen.getByRole('radio', { name: /Servidor \\(opcional\\)/i }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Título') as HTMLInputElement).value).toBe('Intervención 1');
    expect(screen.queryByText(/Proyecto v2 restaurado/)).toBeNull();
  });

  it('rejects projects bound to another MP3 and preserves existing edits', async () => {
    selectSource();
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/i }));
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Abrir proyecto JSON de la grabación seleccionada/i), {
        target: { files: [project('Incompatible', 'cd'.repeat(32))] },
      });
    });

    expect(screen.getByText(/Este proyecto pertenece a otro MP3/)).toBeTruthy();
    expect((screen.getByLabelText('Título') as HTMLInputElement).value).toBe('Intervención 1');
  });

  it('discards an old project if the administrator loads a different audio during hashing', async () => {
    const { upload, player } = selectSource();
    let finishHash!: (value: string) => void;
    const hashPending = new Promise<string>(resolve => { finishHash = resolve; });
    vi.mocked(sha256StudioAudio).mockImplementationOnce(() => hashPending);

    fireEvent.change(screen.getByLabelText(/Abrir proyecto JSON de la grabación seleccionada/i), {
      target: { files: [project()] },
    });
    await act(async () => { await Promise.resolve(); });
    expect(sha256StudioAudio).toHaveBeenCalledTimes(1);

    fireEvent.change(upload, {
      target: { files: [new File(['ID4'], 'different.mp3', { type: 'audio/mpeg' })] },
    });
    Object.defineProperty(player, 'duration', { configurable: true, value: 90 });
    fireEvent.loadedMetadata(player);
    await act(async () => {
      finishHash(hash);
      await hashPending;
    });
    expect(screen.getByText(/Intervenciones \(0\/25\)/)).toBeTruthy();
    expect(screen.queryByText('Paciente · 1 (ES)')).toBeNull();
  });
});
