// @vitest-environment jsdom
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({ importManifest: vi.fn() }));
vi.mock('@/lib/roleplay-manifest-import', () => ({
  prepareRoleplayManifestImport: m.importManifest,
}));
vi.mock('./ScenarioCard', () => ({
  ScenarioCard: ({ scenario, onUpdate, onRemove }: {
    scenario: { id: string; baseAudioPreview: string };
    onUpdate: (id: string, changes: { baseAudioPreview: string }) => void;
    onRemove: (id: string) => void;
  }) => (
    <div>
      <span data-testid="preview-url">{scenario.baseAudioPreview}</span>
      <button type="button" onClick={() => onUpdate(scenario.id, { baseAudioPreview: 'blob:first' })}>
        Elegir primera vista
      </button>
      <button type="button" onClick={() => onUpdate(scenario.id, { baseAudioPreview: 'blob:second' })}>
        Reemplazar vista
      </button>
      <button type="button" onClick={() => onRemove(scenario.id)}>Borrar intervención</button>
    </div>
  ),
}));

import NewRoleplayForm from './NewRoleplayForm';

const editor = () => render(
  <StrictMode><NewRoleplayForm interpreters={[]} candidates={[]} /></StrictMode>,
);

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true, value: vi.fn(() => 'blob:import'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true, value: vi.fn(),
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('audio preview URL lifecycle across committed React updates', () => {
  it('releases replaced previews exactly once, not the currently active preview, even in StrictMode', async () => {
    const view = editor();
    fireEvent.click(screen.getByRole('button', { name: 'Elegir primera vista' }));
    expect(screen.getByTestId('preview-url').textContent).toBe('blob:first');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Reemplazar vista' }));
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first'));
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('preview-url').textContent).toBe('blob:second');
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:second');

    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:second');
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('releases a removed intervention preview and does not revoke it again on unmount', async () => {
    const view = editor();
    fireEvent.click(screen.getByRole('button', { name: 'Elegir primera vista' }));
    fireEvent.click(screen.getByRole('button', { name: 'Borrar intervención' }));
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first'));
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('releases old previews after a successful manifest import, preserving the newly selected audio', async () => {
    m.importManifest.mockResolvedValueOnce([{
      title: 'Nuevo escenario',
      baseAudioFile: new File(['ID3'], 'intervention.mp3', { type: 'audio/mpeg' }),
      durationLimitSec: 60,
      scriptPrompt: '',
      sha256: 'a'.repeat(64),
    }]);
    const view = editor();
    fireEvent.click(screen.getByRole('button', { name: 'Elegir primera vista' }));
    const input = document.getElementById('manifest-roleplay-upload') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(['{}'], 'manifest.json', { type: 'application/json' })] } });
    });
    await waitFor(() => expect(screen.getByTestId('preview-url').textContent).toBe('blob:import'));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first');
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:import');
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:import');
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});
