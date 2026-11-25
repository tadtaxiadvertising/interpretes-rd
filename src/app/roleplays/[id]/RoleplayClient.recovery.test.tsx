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
  function activeSession() {
    return { success: true, data: { id: 'sess-1', status: 'IN_PROGRESS',
      currentScenarioIndex: 0, baseAudioUrl: 'https://example.test/audio',
      scenarios: [{ id: 'scenario-1', order: 0, title: 'Scenario', baseAudioUrl: 'https://example.test/audio', responses: [] }] } };
  }

  it('holds the clinical turn until an enabled opening is confirmed', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) =>
      Response.json(url.endsWith('/opening') ? { success: true, data: { state: 'pending' } } : activeSession()));
    vi.stubGlobal('fetch', fetchMock);
    render(<RoleplayClient sessionId="sess-1" initialIdentity={candidate} openingEnabled />);
    expect(await screen.findByRole('heading', { name: 'Protocolo de apertura bilingüe' })).toBeTruthy();
    expect(screen.queryByText('Scenario')).toBeNull();
  });

  it.each(['confirmed', 'not-required'])('resumes a %s opening without another recording', async state => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) =>
      Response.json(url.endsWith('/opening') ? { success: true, data: { state } } : activeSession())));
    render(<RoleplayClient sessionId="sess-1" initialIdentity={candidate} openingEnabled />);
    expect(await screen.findByText('Scenario')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Protocolo de apertura bilingüe' })).toBeNull();
  });

  it('refreshes the clinical session after opening confirmation before continuing', async () => {
    const locked = activeSession();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ success: true, data: { ...locked.data,
        openingPlaybackLocked: true, baseAudioUrl: null,
        scenarios: [{ ...locked.data.scenarios[0], baseAudioUrl: '' }],
      } }))
      .mockResolvedValueOnce(Response.json({ success: true, data: { state: 'confirmed' } }))
      .mockResolvedValueOnce(Response.json(activeSession()));
    vi.stubGlobal('fetch', fetchMock);
    render(<RoleplayClient sessionId="sess-1" initialIdentity={candidate} openingEnabled />);
    expect(await screen.findByText('Scenario')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toBe('/api/roleplay/session/sess-1');
  });

  it('does not enter the clinical turn if refreshed playback remains locked', async () => {
    const locked = activeSession();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => Response.json(
      url.endsWith('/opening') ? { success: true, data: { state: 'confirmed' } } :
        { success: true, data: { ...locked.data, openingPlaybackLocked: true, baseAudioUrl: null } })));
    render(<RoleplayClient sessionId="sess-1" initialIdentity={candidate} openingEnabled />);
    expect(await screen.findByText(/No se pudo consultar la apertura/)).toBeTruthy();
    expect(screen.queryByText('Scenario')).toBeNull();
  });

  it('does not bypass a failed opening state check', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) =>
      url.endsWith('/opening') ? Response.json({ success: false }, { status: 503 }) : Response.json(activeSession())));
    render(<RoleplayClient sessionId="sess-1" initialIdentity={candidate} openingEnabled />);
    expect(await screen.findByText(/No se pudo consultar la apertura/)).toBeTruthy();
    expect(screen.queryByText('Scenario')).toBeNull();
  });

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
