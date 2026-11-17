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
  ScenarioCard: ({ scenario, startCollapsed }: { scenario: { id: string; title: string; durationLimitSec: number }; startCollapsed?: boolean }) =>
    <div data-testid="draft-scenario"
      data-draft-id={scenario.id}
      data-initially-collapsed={String(Boolean(startCollapsed))}
      data-duration-limit={scenario.durationLimitSec}>
      {scenario.title || 'Borrador'}
    </div>,
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

  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

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
    expect(screen.getByText('1 de 1')).toBeTruthy();
    expect(screen.queryByText(/Verificando archivos/)).toBeNull();
  });

  it('does not ask for confirmation when importing into an untouched form', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    vi.mocked(prepareRoleplayManifestImport).mockResolvedValueOnce([{
      title: 'Importación inicial',
      baseAudioFile: new File(['ID3'], 'initial.mp3', { type: 'audio/mpeg' }),
      durationLimitSec: 120,
      scriptPrompt: '',
      sha256: 'c'.repeat(64),
    }]);
    render(<NewRoleplayForm interpreters={[]} candidates={[]} />);
    await act(async () => { chooseManifest(); });
    expect(screen.getByText('Importación inicial')).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('preserves an edited draft when a valid ZIP import is declined and allows explicit retry', async () => {
    const prepared = [{
      title: 'Escenario importado',
      baseAudioFile: new File(['ID3'], 'prepared.mp3', { type: 'audio/mpeg' }),
      durationLimitSec: 120,
      scriptPrompt: '',
      sha256: 'd'.repeat(64),
    }];
    vi.mocked(prepareRoleplayManifestImport).mockResolvedValue(prepared);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<NewRoleplayForm interpreters={[]} candidates={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /Add Scenario/i }));
    expect(screen.getAllByTestId('draft-scenario')).toHaveLength(2);

    await act(async () => { chooseManifest(); });
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getAllByTestId('draft-scenario')).toHaveLength(2);
    expect(screen.getByText(/Importación cancelada/)).toBeTruthy();
    expect(URL.createObjectURL).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await act(async () => { chooseManifest(); });
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(screen.getAllByTestId('draft-scenario')).toHaveLength(1);
    expect(screen.getByText('Escenario importado')).toBeTruthy();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('shows large verified ZIP imports in compact mode without collapsing the initial manual scenario', async () => {
    const imported = Array.from({ length: 4 }, (_, index) => ({
      title: `Intervención importada ${index + 1}`,
      baseAudioFile: new File(['ID3'], `clip-${index + 1}.mp3`, { type: 'audio/mpeg' }),
      durationLimitSec: 120,
      scriptPrompt: '',
      sha256: String(index + 1).repeat(64),
    }));
    vi.mocked(prepareRoleplayManifestImport).mockResolvedValueOnce(imported);
    render(<NewRoleplayForm interpreters={[]} candidates={[]} />);
    expect(screen.getByTestId('draft-scenario').getAttribute('data-initially-collapsed')).toBe('false');

    await act(async () => { chooseManifest(); });
    const cards = screen.getAllByTestId('draft-scenario');
    expect(cards).toHaveLength(4);
    expect(cards.map(card => card.getAttribute('data-initially-collapsed')))
      .toEqual(['true', 'true', 'true', 'true']);
  });

  it('sets a response limit only on scenarios using the default and preserves individually configured limits', async () => {
    const prepared = [0, 180, 0].map((durationLimitSec, index) => ({
      title: `Intervención ${index + 1}`,
      baseAudioFile: new File(['ID3'], `clip-${index + 1}.mp3`, { type: 'audio/mpeg' }),
      durationLimitSec,
      scriptPrompt: `Guion ${index + 1}`,
      sha256: String(index + 1).repeat(64),
    }));
    vi.mocked(prepareRoleplayManifestImport).mockResolvedValueOnce(prepared);
    render(<NewRoleplayForm interpreters={[]} candidates={[]} />);
    await act(async () => { chooseManifest(); });
    const durationValues = () => screen.getAllByTestId('draft-scenario')
      .map(card => card.getAttribute('data-duration-limit'));
    expect(durationValues()).toEqual(['0', '180', '0']);

    fireEvent.change(screen.getByLabelText(/Tiempo de respuesta para 2 escenarios sin límite personalizado/), {
      target: { value: '90' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar solo a los sin configurar' }));
    expect(durationValues()).toEqual(['90', '180', '90']);
    expect(screen.queryByRole('button', { name: 'Aplicar solo a los sin configurar' })).toBeNull();
    expect(screen.getByText('Intervención 1')).toBeTruthy();
    expect(screen.getByText('Intervención 3')).toBeTruthy();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(3);
  });

  it('offers the same duration shortcut for manually added empty scenarios', () => {
    render(<NewRoleplayForm interpreters={[]} candidates={[]} />);
    expect(screen.queryByRole('button', { name: 'Aplicar solo a los sin configurar' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Add Scenario/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar solo a los sin configurar' }));
    expect(screen.getAllByTestId('draft-scenario')
      .map(card => card.getAttribute('data-duration-limit'))).toEqual(['120', '120']);
  });

  it('keeps existing previews and draft identity when the same verified package is selected again', async () => {
    const prepared = [{
      title: 'Importación idéntica',
      baseAudioFile: new File(['ID3'], 'clip.mp3', { type: 'audio/mpeg' }),
      durationLimitSec: 120,
      scriptPrompt: 'Instrucciones editoriales',
      sha256: 'a'.repeat(64),
    }];
    vi.mocked(prepareRoleplayManifestImport).mockResolvedValue(prepared);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<NewRoleplayForm interpreters={[]} candidates={[]} />);
    await act(async () => { chooseManifest(); });
    const originalId = screen.getByTestId('draft-scenario').getAttribute('data-draft-id');

    await act(async () => { chooseManifest(); });
    expect(prepareRoleplayManifestImport).toHaveBeenCalledTimes(2);
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByTestId('draft-scenario').getAttribute('data-draft-id')).toBe(originalId);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(screen.getByText(/Este paquete ya está importado y no tiene cambios/)).toBeTruthy();
  });

  it('treats edited response limits as work to preserve instead of skipping a repeated package', async () => {
    const prepared = [0, 180, 0].map((durationLimitSec, index) => ({
      title: `Escenario ${index + 1}`,
      baseAudioFile: new File(['ID3'], `clip-${index + 1}.mp3`, { type: 'audio/mpeg' }),
      durationLimitSec, scriptPrompt: '',
      sha256: String(index + 1).repeat(64),
    }));
    vi.mocked(prepareRoleplayManifestImport).mockResolvedValue(prepared);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<NewRoleplayForm interpreters={[]} candidates={[]} />);
    await act(async () => { chooseManifest(); });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar solo a los sin configurar' }));
    const currentDurations = () => screen.getAllByTestId('draft-scenario')
      .map(card => card.getAttribute('data-duration-limit'));
    expect(currentDurations()).toEqual(['120', '180', '120']);

    await act(async () => { chooseManifest(); });
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByText(/Importación cancelada/)).toBeTruthy();
    expect(currentDurations()).toEqual(['120', '180', '120']);
    expect(screen.queryByText(/Este paquete ya está importado/)).toBeNull();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(3);
  });

  const template = {
    id: 'library-safe',
    fingerprint: 'a'.repeat(64),
    scenarios: [{ title: 'Escenario verificado', durationLimitSec: 120, scriptPrompt: '' }],
  };

  it('submits only once when create is activated twice before a response', async () => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { finish = resolve; });
    const request = vi.fn((_url: string, _options: RequestInit) => pending);
    vi.stubGlobal('fetch', request);
    render(<NewRoleplayForm
      interpreters={[{ id: 1, name: 'Intérprete de prueba' }]}
      candidates={[]}
      librarySource={template}
    />);
    fireEvent.change(screen.getByLabelText(/Destinatario/), { target: { value: '1' } });
    const create = screen.getByRole('button', { name: 'Asignar plantilla' });

    await act(async () => {
      fireEvent.click(create);
      fireEvent.click(create);
    });
    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0];
    expect(url).toBe('/api/admin/roleplays');
    expect(options.method).toBe('POST');
    const fields = options.body as FormData;
    expect(fields.get('participantId')).toBe('1');
    expect(fields.get('librarySessionId')).toBe('library-safe');

    await act(async () => {
      finish({ json: async () => ({
        success: true, data: { bulk: false, inviteLink: '/roleplays/mock-invitation' },
      }) } as Response);
      await pending;
    });
    expect(screen.getByText('Roleplay Created!')).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('allows a corrected retry after the server rejects creation', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ json: async () => ({ success: false, error: 'Rechazado por validación' }) })
      .mockResolvedValueOnce({
        json: async () => ({
          success: true, data: { bulk: false, inviteLink: '/roleplays/retry' },
        }),
      });
    vi.stubGlobal('fetch', request);
    render(<NewRoleplayForm
      interpreters={[{ id: 1, name: 'Intérprete de prueba' }]}
      candidates={[]}
      librarySource={template}
    />);
    fireEvent.change(screen.getByLabelText(/Destinatario/), { target: { value: '1' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Asignar plantilla' }));
    });
    expect(screen.getByText('Rechazado por validación')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Asignar plantilla' }));
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Roleplay Created!')).toBeTruthy();
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
