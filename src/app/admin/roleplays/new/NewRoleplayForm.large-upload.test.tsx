// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NewRoleplayForm from './NewRoleplayForm';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; className?: string }) =>
    <a href={href} {...props}>{children}</a>,
}));

// Simulate 13 MiB per clip without allocating 104 MiB in the jsdom test.
// The real form and browser validation still see the declared File.size.
vi.mock('./ScenarioCard', () => ({
  ScenarioCard: ({ scenario, onUpdate }: {
    scenario: { id: string };
    onUpdate: (id: string, updates: Record<string, unknown>) => void;
  }) => (
    <button type="button" onClick={() => {
      const audio = new File(['ID3'], 'synthetic.mp3', { type: 'audio/mpeg' });
      Object.defineProperty(audio, 'size', { configurable: true, value: 13 * 1024 * 1024 });
      onUpdate(scenario.id, { title: 'Consulta de prueba', baseAudioFile: audio });
    }}>
      Preparar escenario
    </button>
  ),
}));

const props = {
  interpreters: [{ id: 11, name: 'Intérprete sintético', status: 'Activo' }],
  candidates: [],
};

function setup(count: number) {
  render(<NewRoleplayForm {...props} />);
  fireEvent.change(screen.getByLabelText(/Destinatario ·/), { target: { value: '11' } });
  for (let i = 1; i < count; i++) {
    fireEvent.click(screen.getByRole('button', { name: /Añadir escenario/i }));
  }
  for (const button of screen.getAllByRole('button', { name: 'Preparar escenario' })) {
    fireEvent.click(button);
  }
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Admin roleplay large multipart upload preflight', () => {
  it('preserves all 8 scenarios and prevents a 104 MiB POST if consent is declined', async () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    setup(8);
    const libraryLink = screen.getByRole('link', {
      name: /Reutilizar audio desde la biblioteca/i,
    });
    expect(libraryLink.getAttribute('href')).toBe('/admin/roleplays/library');
    expect(screen.getByText(/Este lote es voluminoso/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Crear roleplay' }));

    expect(confirm).toHaveBeenCalledOnce();
    expect(String(confirm.mock.calls[0][0])).toContain('104.0 MiB');
    expect(request).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button', { name: 'Preparar escenario' })).toHaveLength(8);
    expect((screen.getByRole('combobox', { name: /Destinatario ·/ }) as HTMLSelectElement).value).toBe('11');
    expect(screen.getByRole('button', { name: 'Crear roleplay' }).hasAttribute('disabled')).toBe(false);
  });

  it('allows an explicit retry without requiring reattachment after declined consent', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ success: true, data: { sessionId: 'synthetic-session' } }),
    });
    vi.stubGlobal('fetch', request);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    setup(8);
    const create = screen.getByRole('button', { name: 'Crear roleplay' });
    fireEvent.click(create);
    expect(request).not.toHaveBeenCalled();

    fireEvent.click(create);
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][0]).toBe('/api/admin/roleplays');
    expect(request.mock.calls[0][1]?.method).toBe('POST');
    await waitFor(() => expect(screen.getByText('¡Roleplay creado correctamente!')).toBeTruthy());
  });

  it('does not add a confirmation step for a normal single-clip request', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ success: true, data: { sessionId: 'synthetic-session' } }),
    });
    vi.stubGlobal('fetch', request);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    setup(1);

    fireEvent.click(screen.getByRole('button', { name: 'Crear roleplay' }));
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.queryByText(/Este lote es voluminoso/)).toBeNull();
  });
});
