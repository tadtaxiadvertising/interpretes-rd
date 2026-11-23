import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  companies: vi.fn(),
  accounts: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    company: { findMany: m.companies },
    account: { findMany: m.accounts },
  },
}));
vi.mock('@/components/admin/CompanyForms', () => ({
  default: () => <div data-testid="company-forms">Formularios</div>,
}));
import CompaniesPage from './page';

describe('Company administration appearance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.companies.mockResolvedValue([{
      id: 1, name: 'Compañía de prueba', legalName: null,
      country: null, accounts: [{ id: 11, name: 'Cuenta A', client: { name: 'Cliente A' } }],
    }]);
    m.accounts.mockResolvedValue([]);
  });

  it('uses the active theme foreground/panel and maintains company ownership details', async () => {
    const markup = renderToStaticMarkup(await CompaniesPage());
    expect(markup).toContain('text-[var(--foreground)]');
    expect(markup).toContain('bg-[var(--theme-panel)]');
    expect(markup).toContain('border-[var(--border)]');
    expect(markup).toContain('Compañía de prueba');
    expect(markup).toContain('Cliente A');
  });
});
