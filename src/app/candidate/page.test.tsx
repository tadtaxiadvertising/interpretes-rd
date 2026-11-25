import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const m = vi.hoisted(() => ({
  identity: vi.fn(),
  loadNotifications: vi.fn(),
  findCandidate: vi.fn(),
  findSession: vi.fn(),
}));

vi.mock('@/lib/notifications/load-navbar-notifications', () => ({ loadNavbarNotifications: m.loadNotifications }));
vi.mock('@/components/NotificationBell', () => ({ NotificationBell: ({ candidateOnly }: { candidateOnly?: boolean }) => <button data-testid="candidate-notifications">{candidateOnly ? 'Avisos de postulación' : 'Avisos generales'}</button> }));

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
    m.loadNotifications.mockResolvedValue([]);
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

  it('offers recovery for a submitted legacy recording with incomplete rubric before QA claims it', async () => {
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
      status: 'SUBMITTED',
      evaluatorId: null,
      qaScoreId: null,
      scenarios: [{ responses: [{ sourceAudioUrl: 'https://audio.example/recorded.webm', selfScore: { fluency: 8 } }] }],
    });

    const markup = renderToStaticMarkup(await CandidatePortalPage());
    expect(markup).toContain('Completar autoevaluación');
    expect(markup).toContain('data-testid="candidate-roleplay-action"');
    expect(markup).not.toContain('href="/roleplays/sess-5"');
  });

  it('hides assessment-only recovery when another scenario has no recording', async () => {
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
      status: 'SUBMITTED',
      evaluatorId: null,
      qaScoreId: null,
      scenarios: [
        { responses: [{ sourceAudioUrl: 'https://audio.example/recorded.webm', selfScore: { fluency: 8 } }] },
        { responses: [] },
      ],
    });

    const markup = renderToStaticMarkup(await CandidatePortalPage());
    expect(markup).not.toContain('Completar autoevaluación');
    expect(markup).not.toContain('data-testid="candidate-roleplay-action"');
  });

  it.each([
    ['QA already claimed', 'admin-1', null, { fluency: 8 }],
    ['QA score exists', null, 9, { fluency: 8 }],
    ['rubric already complete', null, null, { protocol: 8, interpretation: 8, language: 8, service: 8, technical: 8 }],
  ])('hides legacy recovery after %s', async (_reason, evaluatorId, qaScoreId, selfScore) => {
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
      status: 'SUBMITTED',
      evaluatorId,
      qaScoreId,
      scenarios: [{ responses: [{ sourceAudioUrl: 'https://audio.example/recorded.webm', selfScore }] }],
    });

    const markup = renderToStaticMarkup(await CandidatePortalPage());
    expect(markup).not.toContain('Completar autoevaluación');
    expect(markup).not.toContain('data-testid="candidate-roleplay-action"');
  });

  it('does not allow a submitted roleplay to be restarted from the candidate portal', async () => {
    m.findSession.mockResolvedValue({ id: 'sess-5', status: 'SUBMITTED' });

    const markup = renderToStaticMarkup(await CandidatePortalPage());

    expect(markup).not.toContain('data-testid="candidate-roleplay-action"');
    expect(markup).toContain('Tu intento quedó registrado');
  });
  it('shows readable Spanish labels instead of internal step/status codes', async () => {
    m.findCandidate.mockResolvedValue({
      name: 'Candidate',
      email: 'candidate@example.test',
      applications: [{
        id: 'app-5',
        status: 'TECH_SETUP_PENDING',
        currentStep: 'TECH_SETUP',
        updatedAt: new Date('2026-11-13T12:00:00Z'),
      }],
    });
    m.findSession.mockResolvedValue(null);

    const markup = renderToStaticMarkup(await CandidatePortalPage());
    expect(markup).toContain('Setup técnico pendiente');
    expect(markup).toContain('Preparación técnica');
    expect(markup).toContain('min-w-0 break-all');
    expect(markup).not.toContain('>TECH_SETUP<');
    expect(markup).not.toContain('>TECH_SETUP_PENDING<');
  });

  it('loads and renders the restricted bell for a linked candidate account', async () => {
    const id = '123e4567-e89b-42d3-a456-426614174000';
    m.identity.mockResolvedValue({ role: 'candidate', candidateId: 5, provider: 'authjs', profileId: id, userId: 'legacy-user' });
    m.findSession.mockResolvedValue(null);
    const markup = renderToStaticMarkup(await CandidatePortalPage());
    expect(m.loadNotifications).toHaveBeenCalledWith([id], { candidateOnly: true });
    expect(markup).toContain('Avisos de postulación');
    expect(markup).not.toContain('Avisos generales');
  });
});
