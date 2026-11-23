// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  markApplicationReadyAction: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: m.refresh }),
}));
vi.mock('@/app/actions/recruitment', () => ({
  markApplicationReadyAction: m.markApplicationReadyAction,
  updateRecruitmentCandidateAction: vi.fn(),
  deleteCandidate: vi.fn(),
  hireCandidate: vi.fn(),
}));

import { CandidateActions } from './CandidateActions';

const candidate = {
  id: 17, name: 'Candidata de prueba',
  email: 'candidate@example.test', applicationStatus: 'INTERVIEW_PENDING',
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

function openReadyMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Acciones del candidato' }));
  return screen.getByRole('button', { name: 'Mark Ready for Hiring' });
}

describe('Mark candidate ready for hiring', () => {
  it('shows a safe theme-aware message and keeps the action available on server refusal', async () => {
    m.markApplicationReadyAction.mockResolvedValue({ success: false, error: 'private internal message' });
    render(<CandidateActions candidate={candidate} />);

    fireEvent.click(openReadyMenu());
    const error = await screen.findByRole('alert');
    expect(error.textContent).toContain('No se pudo marcar la candidatura como lista');
    expect(error.textContent).not.toContain('private internal message');
    expect(error.className).toContain('text-[var(--theme-danger)]');
    const retry = screen.getByRole('button', { name: 'Mark Ready for Hiring' });
    expect(retry.getAttribute('aria-describedby')).toBe(error.id);
    expect(error.id).toBeTruthy();
    expect(retry.hasAttribute('disabled')).toBe(false);
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it('keeps the menu open and shows neutral feedback if the request throws', async () => {
    m.markApplicationReadyAction.mockRejectedValue(new Error('private credentials in server error'));
    render(<CandidateActions candidate={candidate} />);

    fireEvent.click(openReadyMenu());
    const error = await screen.findByRole('alert');
    expect(error.textContent).toContain('No se pudo confirmar el cambio');
    expect(error.textContent).not.toContain('private credentials');
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it('closes the menu only after the server accepts the new candidate state', async () => {
    m.markApplicationReadyAction.mockResolvedValue({ success: true });
    render(<CandidateActions candidate={candidate} />);

    fireEvent.click(openReadyMenu());
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Mark Ready for Hiring' })).toBeNull());
    expect(m.markApplicationReadyAction).toHaveBeenCalledWith(17);
    expect(m.refresh).toHaveBeenCalledTimes(1);
  });

  it('does not expose an unauthorized ready transition for closed or hired applications', () => {
    render(<CandidateActions candidate={{ ...candidate, applicationStatus: 'HIRED' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Acciones del candidato' }));
    expect(screen.queryByRole('button', { name: 'Mark Ready for Hiring' })).toBeNull();
    expect(m.markApplicationReadyAction).not.toHaveBeenCalled();
  });
});
