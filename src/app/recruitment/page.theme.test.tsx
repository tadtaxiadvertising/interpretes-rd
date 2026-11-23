import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ candidates: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  default: { recruitmentCandidate: { findMany: m.candidates } },
}));
vi.mock('@/components/AddCandidateButton', () => ({
  AddCandidateButton: () => <button type="button">Agregar</button>,
}));
vi.mock('@/components/ExportCandidatesButton', () => ({
  ExportCandidatesButton: () => <button type="button">Exportar</button>,
}));
vi.mock('@/components/CandidateActions', () => ({
  CandidateActions: () => <button type="button">Acciones</button>,
}));
import RecruitmentPage from './page';

describe('Recruitment administration theme layout', () => {
  beforeEach(() => m.candidates.mockReset());

  it('fits the candidate list in a horizontally scrollable region without changing data', async () => {
    m.candidates.mockResolvedValue([{
      id: 1, name: 'María Pérez', email: 'candidate@example.test',
      telefono: '8095550000', pais: 'República Dominicana',
      resultRoleplay: 80,
      applications: [{ status: 'INTERVIEW_PENDING' }],
    }]);
    const html = renderToStaticMarkup(await RecruitmentPage());
    expect(html).toContain('min-w-[850px]');
    expect(html).toContain('max-w-full overflow-x-auto');
    expect(html).toContain('aria-label="Buscar candidatos"');
    expect(html).toContain('María Pérez');
    expect(html).toContain('candidate@example.test');
    expect(html).toContain('80%');
  });
});
