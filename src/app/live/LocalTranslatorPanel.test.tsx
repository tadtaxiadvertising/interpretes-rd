import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import LocalTranslatorPanel from './LocalTranslatorPanel';

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  create: vi.fn(),
  translate: vi.fn(),
  close: vi.fn(),
}));

vi.mock('@/modules/live-engine/core/browser-local-translation', () => ({
  checkLocalTranslation: mocks.check,
  createLocalTranslator: mocks.create,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('opt-in browser-local translation interface', () => {
  it('does not download or translate until explicit activation and translation clicks', async () => {
    mocks.check.mockResolvedValue('available');
    mocks.translate.mockResolvedValue('Good morning');
    mocks.create.mockResolvedValue({ translate: mocks.translate, close: mocks.close });
    render(<LocalTranslatorPanel sourceLanguage="es" finalTranscript="Buenos días" />);
    expect(mocks.create).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Comprobar traducción local' }));
    await screen.findByText('Modelo local disponible para activar.');
    expect(mocks.create).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Activar traducción local' }));
    await screen.findByText('Traductor local listo.');
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith(
      { sourceLanguage: 'es', targetLanguage: 'en' },
      expect.objectContaining({ signal: expect.anything(), onDownloadProgress: expect.any(Function) }),
    );
    expect(mocks.translate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cargar transcripción confirmada' }));
    expect((screen.getByLabelText('Texto para traducir') as HTMLTextAreaElement).value).toBe('Buenos días');
    fireEvent.click(screen.getByRole('button', { name: 'Traducir en este equipo' }));
    await screen.findByText('Good morning');
    expect(mocks.translate).toHaveBeenCalledWith('Buenos días', expect.anything());
  });

  it('fails closed on unsupported browsers with no translator creation', async () => {
    mocks.check.mockResolvedValue('unsupported');
    render(<LocalTranslatorPanel sourceLanguage="en" finalTranscript="" />);
    fireEvent.click(screen.getByRole('button', { name: 'Comprobar traducción local' }));
    await screen.findByText('Este navegador no admite la traducción local.');
    expect(screen.queryByRole('button', { name: /Activar traducción local/ })).toBeNull();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('closes a translator that finishes initializing after cancellation', async () => {
    mocks.check.mockResolvedValue('downloadable');
    let resolve!: (session: { translate: typeof mocks.translate; close: typeof mocks.close }) => void;
    const pending = new Promise<{ translate: typeof mocks.translate; close: typeof mocks.close }>(
      done => { resolve = done; },
    );
    mocks.create.mockReturnValue(pending);
    render(<LocalTranslatorPanel sourceLanguage="es" finalTranscript="" />);
    fireEvent.click(screen.getByRole('button', { name: 'Comprobar traducción local' }));
    await screen.findByText('El navegador deberá descargar el modelo si decides activarlo.');
    fireEvent.click(screen.getByRole('button', { name: 'Descargar y activar modelo local' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar activación' }));

    await act(async () => {
      resolve({ translate: mocks.translate, close: mocks.close });
      await pending;
    });
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Traductor local listo.')).toBeNull();
  });

  it('does not automatically translate protected transcript content', async () => {
    mocks.check.mockResolvedValue('available');
    render(<LocalTranslatorPanel sourceLanguage="en" finalTranscript="Sensitive sample text" />);
    await act(async () => { await Promise.resolve(); });
    expect(mocks.translate).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Texto para traducir') as HTMLTextAreaElement).value).toBe('');
  });
  it('discards an in-flight translation when the user edits source text', async () => {
    mocks.check.mockResolvedValue('available');
    mocks.create.mockResolvedValue({ translate: mocks.translate, close: mocks.close });
    let finish!: (text: string) => void;
    const pending = new Promise<string>(resolve => { finish = resolve; });
    mocks.translate.mockReturnValue(pending);
    render(<LocalTranslatorPanel sourceLanguage="es" finalTranscript="" />);

    fireEvent.click(screen.getByRole('button', { name: 'Comprobar traducción local' }));
    await screen.findByText('Modelo local disponible para activar.');
    fireEvent.click(screen.getByRole('button', { name: 'Activar traducción local' }));
    await screen.findByText('Traductor local listo.');

    const textarea = screen.getByLabelText('Texto para traducir');
    fireEvent.change(textarea, { target: { value: 'Primera frase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Traducir en este equipo' }));
    expect(mocks.translate).toHaveBeenCalledTimes(1);
    const signal = mocks.translate.mock.calls[0]?.[1] as AbortSignal;
    expect(signal.aborted).toBe(false);

    fireEvent.change(textarea, { target: { value: 'Frase corregida' } });
    expect(signal.aborted).toBe(true);
    await act(async () => { finish('Outdated translation'); await pending; });
    expect(screen.queryByText('Outdated translation')).toBeNull();
    expect((textarea as HTMLTextAreaElement).value).toBe('Frase corregida');
  });

});
