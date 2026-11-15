// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({
  importManifest: vi.fn(),
}));
vi.mock('@/lib/roleplay-manifest-import', () => ({
  prepareRoleplayManifestImport: m.importManifest,
}));
vi.mock('./ScenarioCard', () => ({
  ScenarioCard: ({ scenario, onUpdate }: {
    scenario: { id: string };
    onUpdate: (id: string, data: { baseAudioPreview: string }) => void;
  }) => (
    <button type="button" onClick={() => onUpdate(scenario.id, 'blob:manual-preview' && { baseAudioPreview: 'blob:manual-preview' })}>
      Añadir vista previa
    </button>
  ),
}));

import NewRoleplayForm from './NewRoleplayForm';

const renderEditor = () => render(<NewRoleplayForm interpreters={[]} candidates={[]} />);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('Roleplay editor browser blob lifecycle', () => {
  it('releases a manually selected audio preview when the form unmounts', () => {
    const revoke = vi.fn();
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });

    const view = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Añadir vista previa' }));
    view.unmount();

    expect(revoke).toHaveBeenCalledWith('blob:manual-preview');
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it('does not materialize imported previews after navigation cancels a pending SHA-256 import', async () => {
    const createObjectURL = vi.fn(() => 'blob:import-preview');
    const revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    let complete!: (value: unknown[]) => void;
    m.importManifest.mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));

    const view = renderEditor();
    const manifest = new File(['{}'], 'manifest.json', { type: 'application/json' });
    const input = document.getElementById('manifest-roleplay-upload') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [manifest] } });
    expect(m.importManifest).toHaveBeenCalledOnce();

    view.unmount();
    await act(async () => {
      complete([{
        title: 'Synthetic scenario',
        baseAudioFile: new File(['ID3'], 'example.mp3', { type: 'audio/mpeg' }),
        durationLimitSec: 60,
        scriptPrompt: '',
        sha256: '0'.repeat(64),
      }]);
      await Promise.resolve();
    });

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });

  it('releases successfully imported previews when leaving the editor', async () => {
    const createObjectURL = vi.fn(() => 'blob:import-preview');
    const revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    m.importManifest.mockResolvedValueOnce([{
      title: 'Synthetic scenario',
      baseAudioFile: new File(['ID3'], 'example.mp3', { type: 'audio/mpeg' }),
      durationLimitSec: 60,
      scriptPrompt: '',
      sha256: '0'.repeat(64),
    }]);

    const view = renderEditor();
    const manifest = new File(['{}'], 'manifest.json', { type: 'application/json' });
    fireEvent.change(document.getElementById('manifest-roleplay-upload')!, { target: { files: [manifest] } });
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce());

    view.unmount();
    expect(revoke).toHaveBeenCalledWith('blob:import-preview');
  });
});
