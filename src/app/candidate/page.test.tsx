import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const m = vi.hoisted(() => ({
  identity: vi.fn(),
  findCandidate: vi.fn(),
  findSession: vi.fn(),
}));

vi.mock('@/lib/identity/resolve-user', () => ({
  resolveCurrentIdentity: m.identity,
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    recruitmentCandidate: { findUnique: m.findCandidate },
    roleplaySession: { findFirst: m.findSession },
  },
}));

vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`Unexpected redirect: ${path}`); },
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    <a href={href}>{children}</a>,
}));

// Identify the server-rendered action without invoking the client router.
// The real action is tested separately in roleplay-start-candidate.test.ts.
vi.mock('@/components/recruitment/CandidateRoleplayAction', () => ({
  CandidateRoleplayAction: ({ label = 'Comenzar Roleplay' }: { label?: string }) =>
    <button data-testid="candidate-roleplay-action">{label}</button>,
}));

vi.mock('@/components/recruitment/CandidatePasswordSetup', () => ({
  CandidatePasswordSetup: () => null,
}));

import CandidatePortalPage from './page';

describe('candidate roleplay entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.identity.mockResolvedValue({ role: 'candidate', candidateId: 5, provider: 'authjs' });
    m.findCandidate.mockResolvedValue({
      name: 'Candidate',
      email: 'candidate@example.test',
      applications: [{
        id: 'app-5',
        status: 'ROLEPLAY_IN_PROGRESS',
        currentStep: 'ROLEPLAY',
        updatedAt: new Date('2026-11-13T12:00:00Z'),
      }],
    });
  });

  it.each(['STARTED', 'IN_PROGRESS'])(
    'uses the cookie-binding server action instead of a raw session link for %s',
    async (status) => {
      m.findSession.mockResolvedValue({ id: 'sess-5', status });

      const markup = renderToStaticMarkup(await CandidatePortalPage());

      expect(markup).toContain('data-testid="candidate-roleplay-action"');
      expect(markup).toContain('Continuar Roleplay');
      expect(markup).not.toContain('href="/roleplays/sess-5"');
    },
  );

  it('still offers the start action for an assigned but not yet active roleplay', async () => {
    m.findSession.mockResolvedValue({ id: 'sess-5', status: 'INVITED' });
    m.findCandidate.mockResolvedValue({
      name: 'Candidate',
      email: 'candidate@example.test',
      applications: [{
        id: 'app-5',
        status: 'ROLEPLAY_PENDING',
        currentStep: 'ROLEPLAY',
        updatedAt: new Date('2026-11-13T12:00:00Z'),
      }],
    });

    const markup = renderToStaticMarkup(await CandidatePortalPage());

    expect(markup).toContain('Comenzar Roleplay');
    expect(markup).not.toContain('href="/roleplays/sess-5"');
  });

  it.each([
    ['EVALUATED', { totalScore: 62.5, criticalError: false }],
    ['EVALUATED', { totalScore: 89, criticalError: true }],
    ['FAILED', null],
  ])('offers a new roleplay attempt after failed QA: %s / %j', async (sessionStatus, qaScore) => {
    m.findCandidate.mockResolvedValue({
      name: 'Candidate',
      email: 'candidate@example.test',
      applications: [{
        id: 'app-5',
        status: 'ROLEPLAY_REVIEW',
        currentStep: 'ROLEPLAY_REVIEW',
        updatedAt: new Date('2026-11-13T12:00:00Z'),
      }],
    });
    m.findSession.mockResolvedValue({
      id: 'sess-5',
      status: sessionStatus,
      qaScore,
    });

    const markup = renderToStaticMarkup(await CandidatePortalPage());
    expect(markup).toContain('Reintentar Roleplay');
    expect(markup).toContain('data-testid="candidate-roleplay-action"');
    expect(markup).not.toContain('href="/roleplays/sess-5"');
  });

  it.each([
    ['EVALUATED', { totalScore: 89, criticalError: false }, 'ROLEPLAY_REVIEW'],
    ['EVALUATED', null, 'ROLEPLAY_REVIEW'],
    ['SUBMITTED', null, 'ROLEPLAY_REVIEW'],
    ['FAILED', null, 'REJECTED'],
  ])('does not display retry on reviewed or disallowed attempt: %s / %j / %s', async (sessionStatus, qaScore, applicationStatus) => {
    m.findCandidate.mockResolvedValue({
      name: 'Candidate',
      email: 'candidate@example.test',
      applications: [{
        id: 'app-5',
        status: applicationStatus,
        currentStep: 'ROLEPLAY_REVIEW',
        updatedAt: new Date('2026-11-13T12:00:00Z'),
      }],
    });
    m.findSession.mockResolvedValue({
      id: 'sess-5',
      status: sessionStatus,
      qaScore,
    });

    const markup = renderToStaticMarkup(await CandidatePortalPage());
    expect(markup).not.toContain('Reintentar Roleplay');
    expect(markup).not.toContain('data-testid="candidate-roleplay-action"');
    expect(markup).toContain('Tu intento quedó registrado');
  });

  it.each(['REJECTED', 'HIRED', 'ROLEPLAY_REVIEW'])(
    'does not offer stale active sessions for a %s application',
    async (applicationStatus) => {
      m.findCandidate.mockResolvedValue({
        name: 'Candidate',
        email: 'candidate@example.test',
        applications: [{
          id: 'app-5',
          status: applicationStatus,
          currentStep: 'ROLEPLAY_REVIEW',
          updatedAt: new Date('2026-11-13T12:00:00Z'),
        }],
      });
      m.findSession.mockResolvedValue({ id: 'sess-5', status: 'IN_PROGRESS' });

      const markup = renderToStaticMarkup(await CandidatePortalPage());
      expect(markup).not.toContain('data-testid="candidate-roleplay-action"');
      expect(markup).toContain('El Roleplay se habilitará');
    },
  );

  it('does not show the start button during QA review without a failing result', async () => {
    m.findCandidate.mockResolvedValue({
      name: 'Candidate',
      email: 'candidate@example.test',
      applications: [{
        id: 'app-5',
        status: 'ROLEPLAY_REVIEW',
        currentStep: 'ROLEPLAY_REVIEW',
        updatedAt: new Date('2026-11-13T12:00:00Z'),
      }],
    });
    m.findSession.mockResolvedValue({ id: 'sess-5', status: 'INVITED' });

    const markup = renderToStaticMarkup(await CandidatePortalPage());
    expect(markup).not.toContain('data-testid="candidate-roleplay-action"');
  });

  it('does not allow a submitted roleplay to be restarted from the candidate portal', async () => {
    m.findSession.mockResolvedValue({ id: 'sess-5', status: 'SUBMITTED' });

    const markup = renderToStaticMarkup(await CandidatePortalPage());

    expect(markup).not.toContain('data-testid="candidate-roleplay-action"');
    expect(markup).toContain('Tu intento quedó registrado');
  });
});
