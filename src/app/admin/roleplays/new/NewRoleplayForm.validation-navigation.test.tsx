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
  vi.unstubAllGlobals();
});

describe('Roleplay assignment guides administrators to incomplete fields', () => {
  it('focuses the exact missing recipient, title and audio instead of leaving a generic error', () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    render(<NewRoleplayForm interpreters={interpreters} candidates={[]} />);
    const create = screen.getByRole('button', { name: 'Crear roleplay' });

    fireEvent.click(create);
    const participant = screen.getByLabelText(/Destinatario ·/) as HTMLSelectElement;
    expect(document.activeElement).toBe(participant);
    expect(screen.getByText(/Selecciona el intérprete o candidato/)).toBeTruthy();

    fireEvent.change(participant, { target: { value: '1' } });
    fireEvent.click(create);
    const title = screen.getByLabelText('Título del escenario') as HTMLInputElement;
    expect(document.activeElement).toBe(title);
    expect(screen.getByText('El escenario 1 necesita un título.')).toBeTruthy();

    fireEvent.change(title, { target: { value: 'Consulta médica' } });
    // Closing the card unmounts the audio input; validation must reveal it again.
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar detalles del escenario 1' }));
    expect(screen.queryByLabelText(/Audio base/i)).toBeNull();

    fireEvent.click(create);
    let audio = screen.getByLabelText(/Audio base/i) as HTMLInputElement;
    expect(document.activeElement).toBe(audio);
    expect(screen.getByRole('button', { name: 'Ocultar detalles del escenario 1' })
      .getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('El escenario 1 necesita un audio válido.')).toBeTruthy();

    // Repeating validation after closing details issues a fresh focus request.
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar detalles del escenario 1' }));
    expect(screen.queryByLabelText(/Audio base/i)).toBeNull();
    fireEvent.click(create);
    audio = screen.getByLabelText(/Audio base/i) as HTMLInputElement;
    expect(document.activeElement).toBe(audio);
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects an empty library template with a specific error without submitting anything', () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    render(<NewRoleplayForm interpreters={interpreters} candidates={[]}
      librarySource={{ id: 'empty-template', fingerprint: 'a'.repeat(64), scenarios: [] }} />);

    fireEvent.change(screen.getByLabelText(/Destinatario ·/), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Asignar plantilla' }));
    expect(screen.getByText(/La plantilla no contiene escenarios/)).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
  });
});
