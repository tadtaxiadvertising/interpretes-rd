// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  validate: vi.fn(), readiness: vi.fn(), db: {},
}));
vi.mock('@/lib/auth/actions', () => ({ validateAction: mocks.validate }));
vi.mock('@/lib/prisma', () => ({ default: mocks.db }));
vi.mock('@/lib/roleplay/creation-ledger-readiness', () => ({ isCreationLedgerReady: mocks.readiness }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
import CreationReadinessPage from './page';

async function view(check?: string | string[]) {
  return renderToStaticMarkup(await CreationReadinessPage({ searchParams: Promise.resolve({ check }) }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('ROLEPLAY_CREATION_IDEMPOTENCY_ENABLED', 'false');
  vi.stubEnv('ROLEPLAY_IDEMPOTENCY_RECEIPTS_ENABLED', 'true');
  vi.stubEnv('GIT_SHA', 'a'.repeat(40));
  mocks.validate.mockResolvedValue({ user: { role: 'admin' } });
  mocks.readiness.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());

describe('admin runtime diagnostic', () => {
  it.each([{ error: 'not authorized' }, { user: { role: 'interpreter' } }])('does not inspect or reveal configuration to unauthorized users', async auth => {
    mocks.validate.mockResolvedValue(auth);
    const html = await view('1');
    expect(html).toContain('Acceso restringido');
    expect(html).not.toContain('Solo consulta de recibos');
    expect(html).not.toContain('a'.repeat(40));
    expect(mocks.readiness).not.toHaveBeenCalled();
    expect(mocks.validate).toHaveBeenCalledWith('admin');
  });
  it.each([undefined, '0', 'true', ['1', '1']])('does not inspect until one explicit check is requested (%o)', async check => {
    const html = await view(check);
    expect(html).toContain('Comprobación no ejecutada');
    expect(html).toContain('Solo consulta de recibos');
    expect(mocks.readiness).not.toHaveBeenCalled();
  });
  it('reads the runtime connection on explicit request, even when keyed creation is paused', async () => {
    const html = await view('1');
    expect(html).toContain('Catálogo reforzado y permisos efectivos reconocidos');
    expect(html).toContain('Solo consulta de recibos');
    expect(html).toContain('a'.repeat(40));
    expect(html).toContain('no autoriza activar el piloto');
    expect(mocks.readiness).toHaveBeenCalledExactlyOnceWith(mocks.db);
  });
  it('reports unavailable state and suppresses malformed build metadata', async () => {
    vi.stubEnv('GIT_SHA', 'synthetic-secret-not-a-sha');
    mocks.readiness.mockResolvedValue(false);
    const html = await view('1');
    expect(html).toContain('No disponible');
    expect(html).toContain('No informado por el despliegue');
    expect(html).not.toContain('synthetic-secret-not-a-sha');
  });
});
