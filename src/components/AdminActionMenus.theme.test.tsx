// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/app/actions/interpreters', () => ({
  deleteInterpreter: vi.fn(),
  resetInterpreterPassword: vi.fn(),
}));
vi.mock('@/app/actions/recruitment', () => ({
  deleteCandidate: vi.fn(),
  hireCandidate: vi.fn(),
  markApplicationReadyAction: vi.fn(),
  updateRecruitmentCandidateAction: vi.fn(),
}));
vi.mock('./InterpreterForm', () => ({ InterpreterForm: () => null }));
vi.mock('./Modal', () => ({ Modal: () => null }));

import { InterpreterActions } from './InterpreterActions';
import { CandidateActions } from './CandidateActions';

afterEach(() => cleanup());

describe('Admin action menu appearance', () => {
  it('renders the interpreter menu in the active semantic panel theme', () => {
    render(<InterpreterActions interpreter={{ id: 12, name: 'María Pérez', emailCorporativo: null }} />);
    const trigger = screen.getByRole('button', { name: 'Acciones del intérprete' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    const edit = screen.getByRole('button', { name: 'Edit Profile' });
    expect(edit.parentElement?.className).toContain('bg-[var(--theme-panel)]');
    expect(edit.parentElement?.className).toContain('border-[var(--border)]');
    expect(edit.className).toContain('text-[var(--text-secondary)]');
  });

  it('keeps candidate actions readable and avoids changing hiring permissions', () => {
    render(<CandidateActions candidate={{ id: 9, name: 'Candidato', email: 'candidate@example.test', applicationStatus: null }} />);
    const trigger = screen.getByRole('button', { name: 'Acciones del candidato' });
    fireEvent.click(trigger);
    const edit = screen.getByRole('button', { name: 'Edit Application' });
    expect(edit.parentElement?.className).toContain('bg-[var(--theme-panel)]');
    expect(edit.className).toContain('hover:bg-[var(--theme-hover)]');
    expect(screen.queryByRole('button', { name: 'Hire Candidate' })).toBeNull();
  });
});
