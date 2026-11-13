// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RoleplayClient } from './RoleplayClient';

const m = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: m.push }) }));
vi.mock('@/app/actions/roleplay', () => ({
  confirmRoleplayResponse: vi.fn(),
  createRoleplayResponseUpload: vi.fn(),
  saveSelfAssessment: vi.fn(),
  submitRoleplaySession: vi.fn(),
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => null }));
vi.mock('@/components/roleplay/RoleplayIntro', () => ({
  RoleplayIntro: () => <div>Intro</div>,
}));
vi.mock('@/components/roleplay/RoleplayScenario', () => ({
  RoleplayScenario: () => <div>Scenario</div>,
}));
vi.mock('@/components/roleplay/Recorder', () => ({ Recorder: () => null }));
vi.mock('@/components/roleplay/SelfAssessment', () => ({ SelfAssessment: () => null }));
vi.mock('@/components/roleplay/RoleplayProgress', () => ({ RoleplayProgress: () => null }));
vi.mock('@/components/roleplay/RoleplayCompletion', () => ({
  RoleplayCompletion: () => <div>Completion</div>,
}));

const candidate = { role: 'candidate' } as unknown as ComponentProps<typeof RoleplayClient>['initialIdentity'];
const interpreter = { role: 'interpreter' } as unknown as ComponentProps<typeof RoleplayClient>['initialIdentity'];
const admin = { role: 'admin' } as unknown as ComponentProps<typeof RoleplayClient>['initialIdentity'];

function mockSessionResponse(status: number, body: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    status,
    json: async () => body,
  }));
}

describe('roleplay access recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('offers an authenticated return after an anonymous 401 without exposing invitation tokens', async () => {
    mockSessionResponse(401, { success: false, error: 'Not authenticated' });

    render(<RoleplayClient sessionId="sess-1" initialIdentity={null} />);

    const login = await screen.findByRole('button', { name: 'Iniciar sesión para continuar' });
    expect(screen.getByText(/Tu sesión de inicio de sesión ha expirado/)).toBeTruthy();
    fireEvent.click(login);
    expect(m.push).toHaveBeenCalledWith('/login?next=%2Froleplays%2Fsess-1');
  });

  it('sends a candidate with 403 to the candidate portal to renew only their own session', async () => {
    mockSessionResponse(403, { success: false, error: 'Access denied' });

    render(<RoleplayClient sessionId="sess-1" initialIdentity={candidate} />);

    const recovery = await screen.findByRole('button', { name: 'Volver a mi candidatura' });
    expect(screen.getByText(/Las sesiones ajenas siguen protegidas/)).toBeTruthy();
    fireEvent.click(recovery);
    expect(m.push).toHaveBeenCalledWith('/candidate');
    expect(m.push).not.toHaveBeenCalledWith('/roleplays/sess-1');
  });

  it('does not send an interpreter with 403 into the candidate portal', async () => {
    mockSessionResponse(403, { success: false, error: 'Access denied' });

    render(<RoleplayClient sessionId="sess-1" initialIdentity={interpreter} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Volver a mis Roleplays' }));
    expect(m.push).toHaveBeenCalledWith('/dashboard/roleplays');
  });

  it('returns an administrator with an internal error to the admin roleplay area', async () => {
    mockSessionResponse(500, { success: false, error: 'No fue posible cargar la sesión.' });

    render(<RoleplayClient sessionId="sess-1" initialIdentity={admin} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Volver a mis Roleplays' }));
    expect(m.push).toHaveBeenCalledWith('/admin/roleplays');
  });

  it('exits an accessible candidate session back to the candidate portal', async () => {
    mockSessionResponse(200, {
      success: true,
      data: {
        id: 'sess-1',
        status: 'IN_PROGRESS',
        baseAudioUrl: 'https://example.test/audio',
        currentScenarioIndex: 0,
        scenarios: [{ id: 'scenario-1', order: 0, title: 'Scenario', baseAudioUrl: 'https://example.test/audio', responses: [] }],
      },
    });

    render(<RoleplayClient sessionId="sess-1" initialIdentity={candidate} />);

    const exit = await screen.findByRole('button', { name: 'Salir del Roleplay' });
    fireEvent.click(exit);
    expect(m.push).toHaveBeenCalledWith('/candidate');
  });
});
