import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  getMyApplicationAction: vi.fn(),
  submitApplicationAction: vi.fn(),
  acknowledgeInductionAction: vi.fn(),
  startCandidateRoleplay: vi.fn(),
  routerPush: vi.fn(),
}));

vi.mock('@/app/actions/recruitment', () => ({
  getMyApplicationAction: m.getMyApplicationAction,
  submitApplicationAction: m.submitApplicationAction,
  acknowledgeInductionAction: m.acknowledgeInductionAction,
}));
vi.mock('@/app/actions/roleplay', () => ({ startCandidateRoleplay: m.startCandidateRoleplay }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: m.routerPush }),
}));

import RecruitmentFunnel from './RecruitmentFunnel';

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('Recruitment funnel follow-up', () => {
  it('shows candidate tracking at the authoritative fourth step', async () => {
    m.getMyApplicationAction.mockResolvedValue({
      success: true,
      data: {
        found: true,
        funnelStep: 4,
        terminal: false,
        applicationStatus: 'INTERVIEW_PENDING',
        name: 'Test Candidate',
        email: 'candidate@example.test',
      },
    });
    render(<RecruitmentFunnel />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Consulta el avance de tu postulación' })).toBeTruthy());
    expect(screen.getByRole('link', { name: 'Ver mi candidatura' }).getAttribute('href')).toBe('/candidate');
    expect(screen.getByText('Seguimiento')).toBeTruthy();
    expect(screen.queryByText(/Embed de Calendly/)).toBeNull();
    expect(screen.queryByText('Selecciona tu horario para la entrevista.')).toBeNull();
    expect(m.submitApplicationAction).not.toHaveBeenCalled();
    expect(m.acknowledgeInductionAction).not.toHaveBeenCalled();
    expect(m.startCandidateRoleplay).not.toHaveBeenCalled();
  });

  it('uses a safe, readable message for a terminal application', async () => {
    m.getMyApplicationAction.mockResolvedValue({
      success: true,
      data: {
        found: true,
        funnelStep: 4,
        terminal: true,
        applicationStatus: 'HIRED',
        name: 'Test Candidate',
        email: 'candidate@example.test',
      },
    });
    render(<RecruitmentFunnel />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Tu proceso de selección ha finalizado' })).toBeTruthy());
    expect(screen.getByText(/Contratado/)).toBeTruthy();
    expect(screen.queryByText('HIRED')).toBeNull();
    expect(screen.getByRole('link', { name: 'Ver mi candidatura' }).getAttribute('href')).toBe('/candidate');
  });
});
