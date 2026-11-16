// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import RoleplayStudioPage from './page';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    <a href={href}>{children}</a>,
}));

describe('long-source skipped-time overview', () => {
  beforeEach(() => {
    let nextId = 0;
    vi.stubGlobal('crypto', { randomUUID: () => `gap-${++nextId}` });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true, value: vi.fn(() => 'blob:gap-overview'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true, value: vi.fn(),
    });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows selected/excluded time and navigates to an unselected passage locally', () => {
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'long-recording.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 3600 });
    fireEvent.loadedMetadata(player);

    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/i }));
    player.currentTime = 300;
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/i }));

    const summary = screen.getByRole('region', { name: 'Resumen de cortes y espacios' });
    expect(summary.textContent).toContain('Seleccionado: 01:00.0');
    expect(summary.textContent).toContain('Fuera de cortes: 59:00.0');
    expect(summary.textContent).toMatch(/no son silencios detectados/i);

    fireEvent.click(screen.getByText(/Revisar los 2 espacios sin cortes/i));
    const listen = screen.getAllByRole('button', {
      name: /Escuchar espacio sin cortes desde/i,
    });
    expect(listen).toHaveLength(2);
    fireEvent.click(listen[0]); // Biggest unselected stretch begins at 330 seconds.
    expect(player.currentTime).toBe(332);
  });
});
