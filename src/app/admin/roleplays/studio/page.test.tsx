// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import RoleplayStudioPage from './page';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    <a href={href} {...props}>{children}</a>,
}));

describe('Audio Studio clip review player', () => {
  let pause: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubGlobal('crypto', { randomUUID: (() => { let n = 0; return () => `clip-${++n}`; })() });
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:studio-test'), configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('switches between cuts without pausing away the new preview marker', () => {
    const { container } = render(<RoleplayStudioPage />);
    const input = screen.getByLabelText(/Grabación original MP3/i);
    fireEvent.change(input, {
      target: { files: [new File(['ID3'], 'source.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 90 });
    fireEvent.loadedMetadata(player);

    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/i }));
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/i }));
    expect(screen.getAllByRole('button', { name: /Escuchar fragmento/i })).toHaveLength(2);

    pause.mockClear(); // Loading a new file deliberately stops the previous preview.
    const buttons = screen.getAllByRole('button', { name: /Escuchar fragmento/i });
    fireEvent.click(buttons[0]);
    expect(screen.getByRole('button', { name: 'Detener fragmento' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Escuchar fragmento/i }));

    // The browser's delayed onPause event used to clear the new clip's boundary.
    expect(pause).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Detener fragmento' })).toBeTruthy();

    player.currentTime = 60.1;
    fireEvent.timeUpdate(player);
    expect(screen.queryByRole('button', { name: 'Detener fragmento' })).toBeNull();
    expect(pause).toHaveBeenCalledTimes(1);
  });
});
