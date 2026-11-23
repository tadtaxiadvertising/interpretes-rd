// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/app/actions/recruitment', () => ({
  deleteCandidate: vi.fn(), hireCandidate: vi.fn(),
  markApplicationReadyAction: vi.fn(), updateRecruitmentCandidateAction: vi.fn(),
}));
import { CandidateActions } from './CandidateActions';

afterEach(() => cleanup());

const candidate = {
  id: 12, name: 'María Pérez', email: 'candidate@example.test',
  applicationStatus: 'READY_FOR_ACTIVATION',
};

function openAction(action: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Acciones del candidato' }));
  fireEvent.click(screen.getByRole('button', { name: action }));
}

describe('Candidate management dialogs in both appearances', () => {
  it.each([
    ['Edit Application', 'Editar candidatura'],
    ['Send Email', 'Enviar mensaje al candidato'],
    ['Hire Candidate', 'Confirmar contratación'],
    ['Remove Candidate', 'Eliminar candidato'],
  ])('uses semantic surfaces for %s without executing its server action', (action, dialogName) => {
    render(<CandidateActions candidate={candidate} />);
    openAction(action);
    const dialog = screen.getByRole('dialog', { name: dialogName });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.className).toContain('bg-[var(--theme-panel)]');
    expect(dialog.className).toContain('text-[var(--foreground)]');
    expect(dialog.closest('.theme-workspace')).toBeTruthy();
    if (action === 'Hire Candidate') {
      expect(dialog.querySelector('strong')?.className).toContain('text-[var(--foreground)]');
      expect(screen.getByRole('button', { name: 'Confirm hiring' }).className).toContain('bg-[#047857]');
    }
  });

  it('does not expose hiring for candidates not approved for activation', () => {
    render(<CandidateActions candidate={{ ...candidate, applicationStatus: 'APPLIED' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Acciones del candidato' }));
    expect(screen.queryByRole('button', { name: 'Hire Candidate' })).toBeNull();
  });
});
