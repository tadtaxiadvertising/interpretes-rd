// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NewRoleplayForm from './NewRoleplayForm';
import { prepareRoleplayManifestImport } from '@/lib/roleplay-manifest-import';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    <a href={href}>{children}</a>,
}));

vi.mock('@/lib/roleplay-manifest-import', () => ({
  prepareRoleplayManifestImport: vi.fn(),
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
  vi.mocked(prepareRoleplayManifestImport).mockReset();
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

  it('does not hide an import failure when the user fixes an earlier title warning', async () => {
    vi.stubGlobal('fetch', vi.fn());
    render(<NewRoleplayForm
      interpreters={[{ id: 1, name: 'Intérprete de prueba', status: 'Activo' }]}
      candidates={[]}
    />);
    fireEvent.change(screen.getByLabelText(/Destinatario ·/), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear roleplay' }));
    expect(screen.getByText('El escenario 1 necesita un título.')).toBeTruthy();

    // Importing can fail without changing the draft, replacing the local warning.
    vi.mocked(prepareRoleplayManifestImport).mockRejectedValueOnce(
      new Error('El escenario 1 contiene un audio corrupto.'),
    );
    const manifestInput = document.getElementById('manifest-roleplay-upload') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(manifestInput, {
        target: { files: [new File(['{}'], 'manifest.json', { type: 'application/json' })] },
      });
    });
    expect(screen.getByText('El escenario 1 contiene un audio corrupto.')).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox', { name: 'Título del escenario' }), {
      target: { value: 'Consulta médica' },
    });
    // The old prefix-based clearing logic incorrectly hid this unrelated error.
    expect(screen.getByText('El escenario 1 contiene un audio corrupto.')).toBeTruthy();
  });
});
