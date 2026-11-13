// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import InvitePage from './[token]/page';
import InviteByCodePage from '../invite-by-code/[code]/page';

const m = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({
  useParams: () => ({ token: 'private-invite-token', code: 'PRIVATE-CODE' }),
  useRouter: () => ({ push: m.push }),
}));

const pages = [
  ['token link', InvitePage, '/api/roleplay/validate-invite'],
  ['invitation code', InviteByCodePage, '/api/roleplay/validate-invite-by-code'],
] as const;

function respond(status: number, body: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    status,
    json: async () => body,
  }));
}

describe.each(pages)('%s participant entry', (_label, Page, apiPath) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('prompts for login on 401 without putting the invitation into the redirect URL', async () => {
    respond(401, { success: false, error: 'Not authenticated' });

    render(<Page />);

    expect(await screen.findByRole('heading', { name: 'Inicia sesión para continuar' })).toBeTruthy();
    const login = screen.getByRole('link', { name: 'Iniciar sesión' });
    expect(login.getAttribute('href')).toBe('/login');
    expect(login.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(login.getAttribute('href')).not.toContain('private-invite-token');
    expect(login.getAttribute('href')).not.toContain('PRIVATE-CODE');
    expect(screen.getByText(/desde tu portal privado/)).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(apiPath, expect.objectContaining({ referrerPolicy: 'no-referrer' }));
    expect(m.push).not.toHaveBeenCalled();
  });

  it('does not navigate to a forbidden session when another account holds its invitation', async () => {
    respond(403, { success: false, error: 'Access denied' });

    render(<Page />);

    expect(await screen.findByText(/Esta invitación no corresponde a la cuenta/)).toBeTruthy();
    expect(m.push).not.toHaveBeenCalled();
  });

  it('continues directly when a valid authenticated owner has bound the invitation', async () => {
    respond(200, { success: true, data: { sessionId: 'session-1' } });

    render(<Page />);

    await waitFor(() => expect(m.push).toHaveBeenCalledWith('/roleplays/session-1'));
  });
});
