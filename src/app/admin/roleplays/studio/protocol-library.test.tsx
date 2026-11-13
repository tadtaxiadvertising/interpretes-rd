// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RoleplayStudioPage from './page';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    <a href={href}>{children}</a>,
}));

describe('Admin bilingual interpretation protocol templates', () => {
  beforeEach(() => {
    let id = 0;
    vi.stubGlobal('crypto', { randomUUID: () => 'protocol-' + ++id });
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:protocol-audio'), configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(), configurable: true,
    });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('inserts Spanish repetition instructions only when the admin explicitly requests them', () => {
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'source.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 90 });
    fireEvent.loadedMetadata(player);
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/i }));

    const instructions = screen.getByLabelText('Instrucciones para el participante') as HTMLTextAreaElement;
    expect(instructions.value).toBe('');

    fireEvent.change(screen.getByLabelText('Protocolo', { exact: true }), {
      target: { value: 'repetition' },
    });
    fireEvent.change(screen.getByLabelText('Idioma del protocolo'), {
      target: { value: 'es' },
    });
    const insert = screen.getByRole('button', {
      name: /Añadir protocolo seleccionado a esta intervención/i,
    });
    fireEvent.click(insert);

    expect(instructions.value).toContain('Protocolo de repetición (práctica)');
    expect(instructions.value).not.toContain('Opening protocol');
    const unchanged = instructions.value;

    fireEvent.click(insert);
    expect(instructions.value).toBe(unchanged);
    expect(screen.getByText(/Este protocolo ya aparece/)).toBeTruthy();
  });
});
