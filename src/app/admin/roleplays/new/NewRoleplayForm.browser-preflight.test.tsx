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
  ScenarioCard: ({ scenario, onUpdate }: {
    scenario: { id: string; title: string };
    onUpdate: (id: string, changes: Record<string, unknown>) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onUpdate(scenario.id, { title: 'Consulta médica' })}>
        Completar título
      </button>
      <button type="button" onClick={() => {
        const file = new File(['ID3'], 'clip.mp3', { type: 'audio/mpeg' });
        Object.defineProperty(file, 'size', { value: 15 * 1024 * 1024 + 1 });
        onUpdate(scenario.id, { baseAudioFile: file });
      }}>
        Seleccionar audio grande
      </button>
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Admin Roleplay browser-side audio preflight', () => {
  it('prevents an oversized imported/changed audio from being transferred', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<NewRoleplayForm
      interpreters={[{ id: 11, name: 'Intérprete de prueba', status: 'Activo' }]}
      candidates={[]}
    />);
    fireEvent.change(screen.getByLabelText(/Destinatario ·/), { target: { value: '11' } });
    fireEvent.click(screen.getByRole('button', { name: 'Completar título' }));
    fireEvent.click(screen.getByRole('button', { name: 'Seleccionar audio grande' }));

    expect(screen.getByText(/Audio seleccionado:/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Crear roleplay' }));

    expect(screen.getByText('El audio del escenario 1 debe pesar entre 1 byte y 15 MiB.'))
      .toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
