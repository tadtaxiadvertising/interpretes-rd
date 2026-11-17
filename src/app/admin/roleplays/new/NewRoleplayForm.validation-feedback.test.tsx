// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NewRoleplayForm from './NewRoleplayForm';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    <a href={href}>{children}</a>,
}));

// Isolate parent-form validation and feedback from file decoding or audio previews.
vi.mock('./ScenarioCard', () => ({
  ScenarioCard: ({ scenario, onUpdate }: {
    scenario: { id: string; title: string };
    onUpdate: (id: string, changes: { title?: string; scriptPrompt?: string; baseAudioFile?: File }) => void;
  }) => (
    <div>
      <input
        aria-label="Título del escenario"
        value={scenario.title}
        onChange={event => onUpdate(scenario.id, { title: event.target.value })}
      />
      <button type="button" onClick={() => onUpdate(scenario.id, { scriptPrompt: 'Nota' })}>
        Editar instrucciones
      </button>
      <button type="button" onClick={() => onUpdate(scenario.id, {
        baseAudioFile: new File(['ID3'], 'roleplay.mp3', { type: 'audio/mpeg' }),
      })}>
        Adjuntar audio de prueba
      </button>
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('feedback de validación al completar un escenario', () => {
  it('limpia la advertencia de título y audio en cuanto se corrige el dato pendiente', () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    render(<NewRoleplayForm
      interpreters={[{ id: 1, name: 'Intérprete de prueba', status: 'Activo' }]}
      candidates={[]}
    />);
    fireEvent.change(screen.getByLabelText(/Destinatario ·/), { target: { value: '1' } });
    const create = screen.getByRole('button', { name: 'Crear roleplay' });

    fireEvent.click(create);
    expect(screen.getByText('El escenario 1 necesita un título.')).toBeTruthy();

    // Editing another field should not conceal the missing-title warning.
    fireEvent.click(screen.getByRole('button', { name: 'Editar instrucciones' }));
    expect(screen.getByText('El escenario 1 necesita un título.')).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox', { name: 'Título del escenario' }), {
      target: { value: 'Consulta médica' },
    });
    expect(screen.queryByText('El escenario 1 necesita un título.')).toBeNull();

    fireEvent.click(create);
    expect(screen.getByText('El escenario 1 necesita un audio válido.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Adjuntar audio de prueba' }));
    expect(screen.queryByText('El escenario 1 necesita un audio válido.')).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
});
