// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import NewRoleplayForm from './NewRoleplayForm';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    <a href={href}>{children}</a>,
}));

const interpreters = [{ id: 1, name: 'Intérprete de prueba', status: 'Activo' }];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Roleplay assignment guides administrators to incomplete fields', () => {
  it('focuses the exact missing recipient, title and audio instead of leaving a generic error', () => {
    render(<NewRoleplayForm interpreters={interpreters} candidates={[]} />);
    const create = screen.getByRole('button', { name: 'Crear roleplay' });

    fireEvent.click(create);
    const participant = screen.getByLabelText(/Destinatario ·/) as HTMLSelectElement;
    expect(document.activeElement).toBe(participant);
    expect(screen.getByText(/Selecciona el intérprete o candidato/)).toBeTruthy();

    fireEvent.change(participant, { target: { value: '1' } });
    fireEvent.click(create);
    const title = screen.getByLabelText('Scenario title') as HTMLInputElement;
    expect(document.activeElement).toBe(title);
    expect(screen.getByText('El escenario 1 necesita un título.')).toBeTruthy();

    fireEvent.change(title, { target: { value: 'Consulta médica' } });
    fireEvent.click(create);
    const audio = screen.getByLabelText(/Base audio/i) as HTMLInputElement;
    expect(document.activeElement).toBe(audio);
    expect(screen.getByText('El escenario 1 necesita un audio válido.')).toBeTruthy();
  });

  it('rejects an empty library template with a specific error without submitting anything', () => {
    const request = vi.spyOn(globalThis, 'fetch');
    render(<NewRoleplayForm interpreters={interpreters} candidates={[]}
      librarySource={{ id: 'empty-template', fingerprint: 'a'.repeat(64), scenarios: [] }} />);

    fireEvent.change(screen.getByLabelText(/Destinatario ·/), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Asignar plantilla' }));
    expect(screen.getByText(/La plantilla no contiene escenarios/)).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
  });
});
