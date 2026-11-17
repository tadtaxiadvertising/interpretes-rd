import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import SystemReadinessCheck from './SystemReadinessCheck';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubResponse(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: vi.fn().mockResolvedValue(body),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('administrator settings readiness check', () => {
  it('does not probe or claim a healthy connection before explicit admin action', () => {
    const fetchMock = stubResponse(200, { status: 'ready' });
    render(<SystemReadinessCheck />);
    expect(screen.getByRole('status').textContent).toMatch(/Sin comprobar/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/SSL Encryption|CONNECTED|ENABLED|20240428_prisma7_init/)).toBeNull();
  });

  it('reports real readiness and schema details without exposing the database host', async () => {
    const fetchMock = stubResponse(200, {
      status: 'ready',
      database: 'reachable',
      schema: {
        accountHolderName: true,
        roleplayBaseAudioPath: true,
        responseSourceAudioPath: true,
        audioJobSourcePath: true,
        libraryArchiveTable: true,
        roleplayStudioColumns: true,
        roleplayStudioConstraints: true,
      },
    });
    render(<SystemReadinessCheck />);
    fireEvent.click(screen.getByRole('button', { name: 'Verificar conexión y esquema' }));
    expect(await screen.findByText(/La base de datos respondió y las comprobaciones/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/system-readiness', expect.objectContaining({
      method: 'GET', credentials: 'same-origin', cache: 'no-store',
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver detalles del esquema' }));
    expect(screen.getByRole('list', { name: 'Comprobaciones de esquema' }).children).toHaveLength(7);
    expect(screen.getAllByText('Correcto')).toHaveLength(7);
    expect(screen.getByText(/No verifica certificados TLS/)).toBeTruthy();
  });

  it('distinguishes reachable but incomplete database schema from real readiness', async () => {
    stubResponse(503, {
      status: 'schema_mismatch',
      database: 'reachable',
      schema: { accountHolderName: false, roleplayStudioColumns: true },
    });
    render(<SystemReadinessCheck />);
    fireEvent.click(screen.getByRole('button', { name: 'Verificar conexión y esquema' }));
    expect(await screen.findByText(/faltan elementos del esquema/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ver detalles del esquema' }));
    expect(screen.getByText('Pendiente')).toBeTruthy();
    expect(screen.getAllByText('No informado')).toHaveLength(5);
  });

  it('never renders sensitive provider payloads on unauthorized responses', async () => {
    stubResponse(403, { error: 'private:POSTGRES_PASSWORD@host.internal', status: 'ready' });
    render(<SystemReadinessCheck />);
    fireEvent.click(screen.getByRole('button', { name: 'Verificar conexión y esquema' }));
    expect(await screen.findByText(/No se pudo autorizar la consulta/)).toBeTruthy();
    expect(screen.queryByText(/POSTGRES_PASSWORD|host\.internal/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ver detalles del esquema' })).toBeNull();
  });

  it('shows a safe unavailable state when network access fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('PRIVATE_DB_URL')));
    render(<SystemReadinessCheck />);
    fireEvent.click(screen.getByRole('button', { name: 'Verificar conexión y esquema' }));
    expect(await screen.findByText(/No se pudo confirmar el estado/)).toBeTruthy();
    expect(screen.queryByText('PRIVATE_DB_URL')).toBeNull();
  });

  it('removes misleading fixed host, SSL, migration and maintenance controls from settings', () => {
    const page = readFileSync('src/app/settings/page.tsx', 'utf8');
    expect(page).toContain('<SystemReadinessCheck />');
    expect(page).not.toMatch(/db\.kzbkygppplknynrwmtmf|20240428_prisma7_init|SSL Encryption|CONNECTED|Reset Application Cache|Test Connection/);
    expect(page).toContain('href="/settings/import"');
  });
});
