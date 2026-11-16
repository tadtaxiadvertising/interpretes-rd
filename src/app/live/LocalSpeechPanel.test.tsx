import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import LocalSpeechPanel from './LocalSpeechPanel';
import {
  checkOnDeviceSpeechPack,
  startOnDeviceSpeech,
} from '@/modules/live-engine/core/browser-local-speech';

const { stopRecognizer } = vi.hoisted(() => ({ stopRecognizer: vi.fn() }));

vi.mock('@/modules/live-engine/core/browser-local-speech', () => ({
  checkOnDeviceSpeechPack: vi.fn(),
  installOnDeviceSpeechPack: vi.fn(),
  startOnDeviceSpeech: vi.fn(() => ({ stop: stopRecognizer })),
  supportsOnDeviceSpeech: vi.fn(() => true),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('LocalSpeechPanel error handling', () => {
  it('stops recognition immediately after a browser error without retrying remotely', async () => {
    vi.mocked(checkOnDeviceSpeechPack).mockResolvedValue('available');
    render(<LocalSpeechPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Comprobar idioma local' }));
    await screen.findByText('Paquete local disponible.');

    fireEvent.click(screen.getByRole('button', { name: 'Iniciar transcripción local' }));
    expect(screen.getByText('Escuchando y transcribiendo en este dispositivo.')).toBeTruthy();
    const reportError = vi.mocked(startOnDeviceSpeech).mock.calls[0][2];

    act(() => reportError('audio-capture'));

    expect(stopRecognizer).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Reconocimiento local: audio-capture')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Iniciar transcripción local' })).toBeTruthy();
    expect(startOnDeviceSpeech).toHaveBeenCalledTimes(1);
  });
});
