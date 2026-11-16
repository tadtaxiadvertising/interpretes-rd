// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NewRoleplayForm from './NewRoleplayForm';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    <a href={href}>{children}</a>,
}));
vi.mock('./ScenarioCard', () => ({
  ScenarioCard: ({ scenario }: { scenario: { title: string } }) =>
    <div data-testid="scenario-card">{scenario.title || 'Sin título'}</div>,
}));

const interpreters = [
  { id: 1, name: 'María García', externalId: 'INT-101', emailCorporativo: 'maria@ejemplo.test', status: 'Activo' },
  { id: 2, name: 'Luis Pérez', externalId: 'INT-202', emailCorporativo: 'luis@ejemplo.test', status: 'Activo' },
];
const candidates = [
  { id: 11, name: 'Ana Guzmán', email: 'ana@ejemplo.test' },
  { id: 12, name: 'Rosa Moreno', email: 'rosa@ejemplo.test' },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Crear roleplay: selección y resumen simplificados', () => {
  it('busca por identificador, conserva el destinatario al filtrar y no cambia una selección implícitamente', () => {
    render(<NewRoleplayForm interpreters={interpreters} candidates={candidates} />);
    const search = screen.getByRole('searchbox', { name: 'Buscar intérprete' });
    const selector = screen.getByLabelText(/Destinatario ·/) as HTMLSelectElement;

    fireEvent.change(search, { target: { value: 'int-202' } });
    expect(screen.getByRole('option', { name: /Luis Pérez/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /María García/ })).toBeNull();

    fireEvent.change(selector, { target: { value: '2' } });
    expect(screen.getByText(/Luis Pérez · Intérprete/)).toBeTruthy();

    fireEvent.change(search, { target: { value: 'maria' } });
    // Selected option stays accessible even when it does not match the search.
    expect(screen.getByRole('option', { name: /Luis Pérez/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /María García/ })).toBeTruthy();
    expect(selector.value).toBe('2');
    expect(screen.getByText(/Luis Pérez · Intérprete/)).toBeTruthy();

    fireEvent.change(search, { target: { value: 'sin coincidencias' } });
    expect(selector.value).toBe('2');
    expect(screen.getByText(/Sin coincidencias/)).toBeTruthy();
  });

  it('respeta el candidato precargado y limpia filtros solo cuando se cambia de tipo', () => {
    render(<NewRoleplayForm interpreters={interpreters} candidates={candidates} initialCandidateId={11} />);
    expect(screen.getByText(/Ana Guzmán · Candidato/)).toBeTruthy();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar candidato' }), {
      target: { value: 'rosa' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Intérprete' }));
    expect((screen.getByRole('searchbox', { name: 'Buscar intérprete' }) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(/Destinatario ·/) as HTMLSelectElement).value).toBe('');

    fireEvent.change(screen.getByLabelText(/Destinatario ·/), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Intérprete' }));
    expect((screen.getByLabelText(/Destinatario ·/) as HTMLSelectElement).value).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: 'Candidato' }));
    expect((screen.getByLabelText(/Destinatario ·/) as HTMLSelectElement).value).toBe('');
  });

  it('muestra la elegibilidad masiva sin crear sesiones ni saltar la verificación del servidor', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { activeCount: 2, eligibleCount: 1, skippedCount: 1 } }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    render(<NewRoleplayForm interpreters={interpreters} candidates={candidates} />);
    fireEvent.click(screen.getByRole('button', { name: 'Todos los intérpretes activos' }));

    expect(await screen.findByText(/Vista previa \(solo lectura\): 1 elegibles/)).toBeTruthy();
    expect(screen.getByText(/1 intérprete elegible de 2 activos/)).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/admin/roleplays/eligibility');
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin' });
  });
});
