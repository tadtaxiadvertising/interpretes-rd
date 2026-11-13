// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStudioDraft, sha256StudioAudio } from '@/lib/roleplay-studio/draft';
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

describe('Roleplay Studio editable project recovery', () => {
  beforeEach(() => {
    let id = 0;
    vi.stubGlobal('crypto', { randomUUID: () => 'draft-' + ++id });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:studio') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.mocked(sha256StudioAudio).mockResolvedValue(hash);
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

  it('restores verified segment metadata from a project without restoring private captions', async () => {
    selectSource();
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Abrir proyecto del MP3 seleccionado/i), {
        target: { files: [project()] },
      });
    });
    expect(screen.getByText(/Proyecto verificado con SHA-256 y restaurado: 1 intervenciones/)).toBeTruthy();
    expect((screen.getByLabelText('Título') as HTMLInputElement).value).toBe('Paciente · 1 (ES)');
    expect(screen.getByDisplayValue('Interpretar con fidelidad')).toBeTruthy();
    expect(screen.queryByText(/Transcripción de referencia · solo editor/)).toBeNull();
  });

  it('rejects projects bound to another MP3 and preserves existing edits', async () => {
    selectSource();
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/i }));
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Abrir proyecto del MP3 seleccionado/i), {
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

    fireEvent.change(screen.getByLabelText(/Abrir proyecto del MP3 seleccionado/i), {
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
