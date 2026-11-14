// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareRoleplayManifestImport } from '@/lib/roleplay-manifest-import';
import { extractStudioZip } from '@/lib/roleplay-studio/zip';
import { extractExternalStudioZip } from '@/lib/roleplay-studio/external-zip';
import NewRoleplayForm from './NewRoleplayForm';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    <a href={href}>{children}</a>,
}));
vi.mock('./ScenarioCard', () => ({
  ScenarioCard: ({ scenario }: { scenario: { title: string } }) =>
    <div data-testid="draft-scenario">{scenario.title || 'Borrador'}</div>,
}));
vi.mock('@/lib/roleplay-manifest-import', () => ({
  prepareRoleplayManifestImport: vi.fn(),
}));
vi.mock('@/lib/roleplay-studio/zip', () => ({ extractStudioZip: vi.fn() }));
vi.mock('@/lib/roleplay-studio/external-zip', () => ({ extractExternalStudioZip: vi.fn() }));

describe('Admin roleplay import concurrency', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:validated-mp3'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => { cleanup(); });

  const chooseManifest = () => {
    fireEvent.change(screen.getByLabelText(/Importar roleplay preparado/i), {
      target: {
        files: [new File(['{}'], 'manifest.json', { type: 'application/json' })],
      },
    });
  };

  it('does not replace an edited draft when an earlier SHA-256 import resolves', async () => {
    let resolve!: (scenarios: Array<{
      title: string;
      baseAudioFile: File;
      durationLimitSec: number;
      scriptPrompt: string;
      sha256: string;
    }>) => void;
    vi.mocked(prepareRoleplayManifestImport).mockImplementationOnce(
      () => new Promise(result => { resolve = result; }),
    );
    render(<NewRoleplayForm interpreters={[]} candidates={[]} />);

    chooseManifest();
    expect(screen.getByRole('status').textContent).toContain('Verificando archivos');

    fireEvent.click(screen.getByRole('button', { name: /Add Scenario/i }));
    expect(screen.getAllByTestId('draft-scenario')).toHaveLength(2);
    expect(screen.getByText(/Importación descartada/i)).toBeTruthy();

    await act(async () => {
      resolve([{
        title: 'Importación obsoleta',
        baseAudioFile: new File(['ID3'], 'fragment.mp3', { type: 'audio/mpeg' }),
        durationLimitSec: 120,
        scriptPrompt: '',
        sha256: 'a'.repeat(64),
      }]);
    });
    expect(screen.getAllByTestId('draft-scenario')).toHaveLength(2);
    expect(screen.queryByText('Importación obsoleta')).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByText(/Verificando archivos/)).toBeNull();
  });

  it('imports scenarios successfully when the admin does not edit the draft', async () => {
    vi.mocked(prepareRoleplayManifestImport).mockResolvedValueOnce([{
      title: 'Segmento aprobado',
      baseAudioFile: new File(['ID3'], 'fragment.mp3', { type: 'audio/mpeg' }),
      durationLimitSec: 120,
      scriptPrompt: '',
      sha256: 'b'.repeat(64),
    }]);
    render(<NewRoleplayForm interpreters={[]} candidates={[]} />);
    await act(async () => { chooseManifest(); });

    expect(screen.getByText('Segmento aprobado')).toBeTruthy();
    expect(screen.getAllByTestId('draft-scenario')).toHaveLength(1);
    expect(screen.queryByText(/Verificando archivos/)).toBeNull();
  });

  it('uses the external ZIP fallback and canonical SHA-256 validation without publishing', async () => {
    vi.mocked(extractStudioZip).mockRejectedValueOnce(new Error('ZIP nativo incompatible'));
    const extracted = [
      new File(['{}'], 'manifest.json', { type: 'application/json' }),
      new File(['ID3'], 'external-clip.mp3', { type: 'audio/mpeg' }),
    ];
    vi.mocked(extractExternalStudioZip).mockResolvedValueOnce(extracted);
    vi.mocked(prepareRoleplayManifestImport).mockResolvedValueOnce([{
      title: 'Intervención 1',
      baseAudioFile: extracted[1],
      durationLimitSec: 0,
      scriptPrompt: '',
      sha256: 'f'.repeat(64),
    }]);
    render(<NewRoleplayForm interpreters={[]} candidates={[]} />);
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Importar roleplay preparado/i), {
        target: {
          files: [new File(['ZIP'], 'audio-studio.zip', { type: 'application/zip' })],
        },
      });
    });

    expect(extractStudioZip).toHaveBeenCalledTimes(1);
    expect(extractExternalStudioZip).toHaveBeenCalledTimes(1);
    expect(prepareRoleplayManifestImport).toHaveBeenCalledWith(extracted);
    expect(screen.getByText('Intervención 1')).toBeTruthy();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('keeps the existing draft when both ZIP formats fail validation', async () => {
    vi.mocked(extractStudioZip).mockRejectedValueOnce(new Error('ZIP nativo incompatible'));
    vi.mocked(extractExternalStudioZip).mockRejectedValueOnce(new Error('ZIP externo inválido o inseguro'));
    render(<NewRoleplayForm interpreters={[]} candidates={[]} />);
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Importar roleplay preparado/i), {
        target: {
          files: [new File(['BAD'], 'unknown.zip', { type: 'application/zip' })],
        },
      });
    });

    expect(screen.getByText(/ZIP externo inválido o inseguro/)).toBeTruthy();
    expect(screen.getAllByTestId('draft-scenario')).toHaveLength(1);
    expect(prepareRoleplayManifestImport).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

});
