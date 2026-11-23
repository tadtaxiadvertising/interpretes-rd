import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ listInterpreters: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  default: { interpreter: { findMany: m.listInterpreters } },
}));
vi.mock('@/components/AddInterpreterButton', () => ({
  AddInterpreterButton: () => <button type="button">Agregar intérprete</button>,
}));
vi.mock('@/components/ExportInterpretersButton', () => ({
  ExportInterpretersButton: () => <button type="button">Exportar</button>,
}));
vi.mock('@/components/InterpreterActions', () => ({
  InterpreterActions: () => <button type="button">Acciones</button>,
}));
vi.mock('@/components/admin/BankingInfoCard', () => ({
  BankingInfoCard: () => null,
}));
import InterpretersPage from './page';

describe('Interpreter directory themes', () => {
  beforeEach(() => m.listInterpreters.mockReset());

  it('retains visible semantic surfaces and search labels when empty', async () => {
    m.listInterpreters.mockResolvedValue([]);
    const markup = renderToStaticMarkup(await InterpretersPage());
    expect(markup).toContain('Directorio de intérpretes');
    expect(markup).toContain('aria-label="Buscar por nombre, ID o campaña"');
    expect(markup).toContain('bg-[var(--theme-panel)]');
    expect(markup).toContain('text-[var(--foreground)]');
  });

  it('keeps interpreter actions visible to touch users and focus users', async () => {
    m.listInterpreters.mockResolvedValue([{
      id: 14, name: 'María Pérez', externalId: 'RD14',
      status: 'Activo', campaign: 'Medical', tariffPerMinute: 0.2,
      monthlyGoal: 1800, userProfile: null,
    }]);
    const markup = renderToStaticMarkup(await InterpretersPage());
    expect(markup).toContain('María Pérez');
    expect(markup).toContain('sm:group-focus-within:opacity-100');
    expect(markup).toContain('opacity-100');
    expect(markup).toContain('text-[var(--theme-success)]');
  });
});
