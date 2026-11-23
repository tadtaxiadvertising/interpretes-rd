// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  hireCandidate: vi.fn(),
  deleteCandidate: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: m.refresh }),
}));
vi.mock('@/app/actions/recruitment', () => ({
  hireCandidate: m.hireCandidate,
  deleteCandidate: m.deleteCandidate,
  markApplicationReadyAction: vi.fn(),
  updateRecruitmentCandidateAction: vi.fn(),
}));

import { CandidateActions } from './CandidateActions';

const candidate = {
  id: 84, name: 'Candidata de prueba',
  email: 'candidate@example.test', applicationStatus: 'READY_FOR_ACTIVATION',
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

function openConfirmation(name: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Acciones del candidato' }));
  fireEvent.click(screen.getByRole('button', { name }));
}

describe('Candidate destructive action confirmations', () => {
  it('keeps hiring confirmation visible on server rejection and explains the failure inline', async () => {
    m.hireCandidate.mockResolvedValue({ success: false, error: 'Transition rejected' });
    render(<CandidateActions candidate={candidate} />);
    openConfirmation('Hire Candidate');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm hiring' }));

    const notice = await screen.findByRole('alert');
    expect(notice.textContent).toContain('La contratación no se completó');
    expect(screen.getByRole('dialog', { name: 'Confirmar contratación' })).toBeTruthy();
    expect(m.hireCandidate).toHaveBeenCalledTimes(1);
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it('closes hiring confirmation only after the server confirms success', async () => {
    m.hireCandidate.mockResolvedValue({ success: true });
    render(<CandidateActions candidate={candidate} />);
    openConfirmation('Hire Candidate');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm hiring' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Confirmar contratación' })).toBeNull());
    expect(m.refresh).toHaveBeenCalledTimes(1);
    expect(m.hireCandidate).toHaveBeenCalledWith(84);
  });

  it('keeps delete confirmation visible if the server could not complete deletion', async () => {
    m.deleteCandidate.mockResolvedValue({ success: false, error: 'Deletion denied' });
    render(<CandidateActions candidate={candidate} />);
    openConfirmation('Remove Candidate');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect((await screen.findByRole('alert')).textContent).toContain('No se pudo eliminar');
    expect(screen.getByRole('dialog', { name: 'Eliminar candidato' })).toBeTruthy();
    expect(m.deleteCandidate).toHaveBeenCalledTimes(1);
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it('closes delete confirmation after a confirmed successful deletion', async () => {
    m.deleteCandidate.mockResolvedValue({ success: true });
    render(<CandidateActions candidate={candidate} />);
    openConfirmation('Remove Candidate');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Eliminar candidato' })).toBeNull());
    expect(m.deleteCandidate).toHaveBeenCalledWith(84);
    expect(m.refresh).toHaveBeenCalledTimes(1);
  });

  it('does not close a confirmation while the hiring request remains pending', async () => {
    m.hireCandidate.mockImplementation(() => new Promise(() => {}));
    render(<CandidateActions candidate={candidate} />);
    openConfirmation('Hire Candidate');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm hiring' }));

    const confirm = screen.getByRole('button', { name: 'Confirm hiring' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    const cancel = screen.getByRole('button', { name: 'Cancelar' });
    expect(cancel.hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Confirmar contratación' })).toBeTruthy();
  });
});
