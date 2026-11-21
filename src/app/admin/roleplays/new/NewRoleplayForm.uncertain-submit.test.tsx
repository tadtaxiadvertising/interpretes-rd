// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NewRoleplayForm from './NewRoleplayForm';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; className?: string }) =>
    <a href={href} {...props}>{children}</a>,
}));

const props = {
  interpreters: [{ id: 11, name: 'Intérprete sintético', status: 'Activo' }],
  candidates: [],
  librarySource: {
    id: 'synthetic-template',
    fingerprint: 'a'.repeat(64),
    scenarios: [{ title: 'Intervención sintética', durationLimitSec: 120, scriptPrompt: '' }],
  },
};

function submit() {
  render(<NewRoleplayForm {...props} />);
  fireEvent.change(screen.getByLabelText(/Destinatario ·/), { target: { value: '11' } });
  fireEvent.click(screen.getByRole('button', { name: 'Asignar plantilla' }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Roleplay admin: uncertain creation outcome', () => {
  it('warns of a potentially committed roleplay on transport failure without losing the draft', async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error('PRIVATE_SIGNED_TOKEN_SYNTHETIC'));
    vi.stubGlobal('fetch', fetchSpy);
    submit();

    await waitFor(() => expect(screen.getByRole('status').textContent)
      .toContain('podría haberse creado'));
    const link = screen.getByRole('link', { name: 'Comprobar los roleplays existentes' });
    expect(link.getAttribute('href')).toBe('/admin/roleplays');
    expect(screen.getByText(/1\. Intervención sintética/)).toBeTruthy();
    expect(screen.getByText('No se pudo confirmar el resultado de la creación.')).toBeTruthy();
    expect(document.body.textContent).not.toContain('PRIVATE_SIGNED_TOKEN_SYNTHETIC');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('handles an HTML/gateway response with no JSON as an uncertain result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 502,
      json: async () => { throw new SyntaxError('Unexpected <html>PRIVATE_PROXY_ERROR'); },
    }));
    submit();

    await waitFor(() => expect(screen.getByRole('link', {
      name: 'Comprobar los roleplays existentes',
    })).toBeTruthy());
    expect(document.body.textContent).not.toContain('PRIVATE_PROXY_ERROR');
  });

  it('treats missing success/data as uncertain rather than reporting a false successful creation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    }));
    submit();

    await waitFor(() => expect(screen.getByText('No se pudo confirmar el resultado de la creación.'))
      .toBeTruthy());
    expect(screen.queryByText('¡Roleplay creado correctamente!')).toBeNull();
    expect(screen.getByRole('link', { name: 'Comprobar los roleplays existentes' })).toBeTruthy();
  });

  it('keeps a definitive structured rejection distinct from an uncertain transport result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 409,
      json: async () => ({ success: false, error: 'Ya existe una sesión de roleplay' }),
    }));
    submit();

    await waitFor(() => expect(screen.getByText('Ya existe una sesión de roleplay')).toBeTruthy());
    expect(screen.queryByRole('link', { name: 'Comprobar los roleplays existentes' })).toBeNull();
    expect(screen.queryByText('No se pudo confirmar el resultado de la creación.')).toBeNull();
  });
  it('treats a structured HTTP 500 as ambiguous because DB commit may have succeeded', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false, status: 500,
      json: async () => ({
        success: false,
        error: 'FAKE_DB_CONNECTION_STRING',
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    submit();

    await waitFor(() => expect(screen.getByText('No se pudo confirmar el resultado de la creación.')).toBeTruthy());
    expect(screen.getByRole('link', { name: 'Comprobar los roleplays existentes' })).toBeTruthy();
    expect(document.body.textContent).not.toContain('FAKE_DB_CONNECTION_STRING');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing single-session identity even when success is true', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ success: true, data: {} }),
    }));
    submit();

    await waitFor(() => expect(screen.getByText('No se pudo confirmar el resultado de la creación.')).toBeTruthy());
    expect(screen.getByRole('link', { name: 'Comprobar los roleplays existentes' })).toBeTruthy();
    expect(screen.queryByText('¡Roleplay creado correctamente!')).toBeNull();
    expect(document.body.textContent).not.toContain('undefined');
  });

  it('rejects success from an HTTP conflict response as an inconsistent outcome', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 409,
      json: async () => ({ success: true, data: { inviteLink: '/roleplays/not-confirmed' } }),
    }));
    submit();
    await waitFor(() => expect(screen.getByText('No se pudo confirmar el resultado de la creación.')).toBeTruthy());
    expect(screen.queryByText('¡Roleplay creado correctamente!')).toBeNull();
  });

  it('keeps accepting a valid successful single-session payload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ success: true, data: { sessionId: 'synthetic-session-id' } }),
    }));
    submit();
    await waitFor(() => expect(screen.getByText('¡Roleplay creado correctamente!')).toBeTruthy());
    expect(screen.queryByRole('link', { name: 'Comprobar los roleplays existentes' })).toBeNull();
  });

});
