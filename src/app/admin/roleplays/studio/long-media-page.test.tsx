// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import RoleplayStudioPage from './page';
import { fingerprintLocalMedia } from '@/lib/roleplay-studio/long-media';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    <a href={href}>{children}</a>,
}));
vi.mock('@/lib/roleplay-studio/long-media', async () => {
  const actual = await vi.importActual<typeof import('@/lib/roleplay-studio/long-media')>(
    '@/lib/roleplay-studio/long-media',
  );
  return { ...actual, fingerprintLocalMedia: vi.fn(async () => 'ab'.repeat(32)) };
});

describe('Audio Studio video and long source local preparation', () => {
  beforeEach(() => {
    let sequence = 0;
    vi.stubGlobal('crypto', { randomUUID: () => 'video-' + ++sequence });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true, value: vi.fn(() => 'blob:long-video'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true, value: vi.fn(),
    });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  function openVideo(seconds = 5 * 3600) {
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['video-content'], 'medical.mp4', { type: 'video/mp4' })] },
    });
    const player = container.querySelector('video')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: seconds });
    fireEvent.loadedMetadata(player);
    return player;
  }
  it('opens 5h video locally without an upload or a whole-source decode', () => {
    const player = openVideo();
    expect(player).toBeTruthy();
    expect(screen.getByText(/Preparación local:/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Detectar pausas en servidor/i })).toBeNull();
    expect(screen.getByRole('button', { name: /Añadir intervención/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/i }));
    expect(screen.getByRole('button', { name: /Descargar plan local de cortes/i })).toBeTruthy();
  });
  it('imports timecodes after 4 hours and never posts the original video to export ZIP', async () => {
    openVideo();
    const content = '1\n04:30:00,000 --> 04:30:12,000\nDoctor: Please sit down.';
    const file = new File([content], 'long.srt', { type: 'text/plain' });
    Object.defineProperty(file, 'text', { configurable: true, value: async () => content });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [file] },
      });
    });
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Descargar plan local de cortes/i }));
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fingerprintLocalMedia).toHaveBeenCalledOnce();
    expect(screen.getByText(/Plan de cortes local descargado/i)).toBeTruthy();
  });
});
