// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RoleplayStudioPage from './page';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) =>
    <a href={href} {...props}>{children}</a>,
}));

describe('Audio Studio subtitle import lifecycle', () => {
  beforeEach(() => {
    let id = 0;
    vi.stubGlobal('crypto', { randomUUID: () => 'test-cue-' + ++id });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:test-mp3') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('ignores subtitles that finish loading after the administrator changes the source recording', async () => {
    const { container } = render(<RoleplayStudioPage />);
    const audioInput = screen.getByLabelText(/Grabación original MP3/i);
    fireEvent.change(audioInput, {
      target: { files: [new File(['ID3-a'], 'first.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 60 });
    fireEvent.loadedMetadata(player);

    let finishRead!: (value: string) => void;
    const read = new Promise<string>(resolve => { finishRead = resolve; });
    const subtitle = new File(['pending'], 'first.srt', { type: 'text/plain' });
    Object.defineProperty(subtitle, 'text', { configurable: true, value: () => read });
    fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
      target: { files: [subtitle] },
    });

    // The admin selects another recording before the old subtitle file finishes.
    fireEvent.change(audioInput, {
      target: { files: [new File(['ID3-b'], 'second.mp3', { type: 'audio/mpeg' })] },
    });
    Object.defineProperty(player, 'duration', { configurable: true, value: 60 });
    fireEvent.loadedMetadata(player);

    await act(async () => {
      finishRead('1\n00:00:00,000 --> 00:00:01,000\nDoctor: Private old dialogue');
      await read;
    });

    expect(screen.getByText(/Intervenciones \(0\/25\)/i)).toBeTruthy();
    expect(screen.queryByText(/Doctor · 1/i)).toBeNull();
    expect(screen.queryByText(/Private old dialogue/i)).toBeNull();
  });
});
