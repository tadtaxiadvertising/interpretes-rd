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
import { DIRECT_UPLOAD_FORM_FLAGS, OPENING_ASSIGNMENT_FLAGS } from '@/lib/roleplay/direct-upload-pilot-config';

async function view(check?: string | string[]) {
  return renderToStaticMarkup(await CreationReadinessPage({ searchParams: Promise.resolve({ check }) }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('ROLEPLAY_CREATION_IDEMPOTENCY_ENABLED', 'false');
  vi.stubEnv('ROLEPLAY_IDEMPOTENCY_RECEIPTS_ENABLED', 'true');
  vi.stubEnv('GIT_SHA', 'a'.repeat(40));
  vi.stubEnv('ROLEPLAY_DIRECT_UPLOAD_RESERVATION_API_ENABLED', 'false');
  mocks.validate.mockResolvedValue({ user: { role: 'admin' } });
  mocks.readiness.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());

describe('admin runtime diagnostic', () => {
  it('shows only configuration states for direct uploads, without a runtime probe or secret values', async () => {
    for (const name of [...OPENING_ASSIGNMENT_FLAGS, ...DIRECT_UPLOAD_FORM_FLAGS]) vi.stubEnv(name, 'true');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'synthetic-project-value');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'synthetic-browser-value');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-server-value');
    vi.stubEnv('FRONTEND_ORIGIN', 'synthetic-origin-value');
    const html = await view();
    expect(html).toContain('Banderas de subida directa configuradas');
    expect(html).toContain('Ver requisitos de configuración');
    expect(html).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(html).not.toContain('synthetic-');
    expect(html).toContain('No verifica las credenciales');
    expect(mocks.readiness).not.toHaveBeenCalled();
    vi.stubEnv('ROLEPLAY_DIRECT_UPLOAD_FORM_ENABLED', 'false');
    expect(await view()).toContain('Subida directa no configurada por completo');
    expect(await view()).toContain('Consultar una reserva guardada');
  });
  it('only exposes saved reservation lookup to authorized admins while the reservation API is enabled', async () => {
    expect(await view()).not.toContain('Consultar una reserva guardada');
    vi.stubEnv('ROLEPLAY_DIRECT_UPLOAD_RESERVATION_API_ENABLED', 'true');
    expect(await view()).toContain('Consultar una reserva guardada');
    expect(mocks.readiness).not.toHaveBeenCalled();
    mocks.validate.mockResolvedValue({ user: { role: 'interpreter' } });
    expect(await view()).not.toContain('Consultar una reserva guardada');
  });
  it.each([{ error: 'not authorized' }, { user: { role: 'interpreter' } }])('does not inspect or reveal configuration to unauthorized users', async auth => {
    mocks.validate.mockResolvedValue(auth);
    const html = await view('1');
    expect(html).toContain('Acceso restringido');
    expect(html).not.toContain('Solo consulta de recibos');
    expect(html).not.toContain('Subida directa de audios');
    expect(html).not.toContain('Conserva la recuperación');
    expect(html).not.toContain('Contrasta el SHA');
    expect(html).not.toContain('Evidencia de comprobación');
    expect(html).not.toContain('Copiar diagnóstico');
    expect(html).not.toContain('a'.repeat(40));
    expect(mocks.readiness).not.toHaveBeenCalled();
    expect(mocks.validate).toHaveBeenCalledWith('admin');
  });
  it.each([undefined, '0', 'true', ['1', '1']])('does not inspect until one explicit check is requested (%o)', async check => {
    const html = await view(check);
    expect(html).toContain('Comprobación no ejecutada');
    expect(html).not.toContain('Evidencia de comprobación');
    expect(html).not.toContain('Copiar diagnóstico');
    expect(html).toContain('Solo consulta de recibos');
    expect(mocks.readiness).not.toHaveBeenCalled();
  });
  it.each([
    ['false', 'false', 'Mantén el flujo tradicional'],
    ['false', 'true', 'Conserva la recuperación de solicitudes anteriores'],
    ['true', 'false', 'No uses la creación con clave'],
    ['true', 'true', 'La configuración por sí sola no confirma'],
  ])('explains the safe next step for creation=%s receipts=%s', async (creation, receipts, guidance) => {
    vi.stubEnv('ROLEPLAY_CREATION_IDEMPOTENCY_ENABLED', creation);
    vi.stubEnv('ROLEPLAY_IDEMPOTENCY_RECEIPTS_ENABLED', receipts);
    const html = await view();
    expect(html).toContain(guidance);
    expect(html).toContain('Ejecuta la comprobación');
    expect(mocks.readiness).not.toHaveBeenCalled();
  });
  it('reads the runtime connection on explicit request, even when keyed creation is paused', async () => {
    const html = await view('1');
    expect(html).toContain('Catálogo reforzado y permisos efectivos reconocidos');
    expect(html).toContain('Solo consulta de recibos');
    expect(html).toContain('a'.repeat(40));
    expect(html).toContain('no autoriza activar el piloto');
    expect(html).toContain('Contrasta el SHA y la identidad del proyecto');
    expect(mocks.readiness).toHaveBeenCalledExactlyOnceWith(mocks.db);
  });
  it('provides a timestamped evidence summary only after a requested check', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-27T18:00:00Z'));
      const html = await view('1');
      expect(html).toContain('Evidencia de comprobación');
      expect(html).toContain('Copiar diagnóstico');
      expect(html).toContain('Fecha de comprobación (UTC): 2026-11-27T18:00:00.000Z');
      expect(html).toContain('SHA del servicio: ' + 'a'.repeat(40));
      expect(html).toContain('Modo: receipts-only');
      expect(html).toContain('Registro de idempotencia: Disponible según comprobación');
      expect(html).toContain('Resultado puntual; no autoriza activar el piloto.');
      expect(mocks.readiness).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it('reports unavailable state and suppresses malformed build metadata', async () => {
    vi.stubEnv('GIT_SHA', 'synthetic-secret-not-a-sha');
    mocks.readiness.mockResolvedValue(false);
    const html = await view('1');
    expect(html).toContain('No disponible');
    expect(html).toContain('No actives el piloto');
    expect(html).toContain('no repitas creaciones inciertas');
    expect(html).toContain('No informado por el despliegue');
    expect(html).not.toContain('synthetic-secret-not-a-sha');
    expect(html).toContain('SHA del servicio: No informado');
    expect(html).toContain('Registro de idempotencia: No disponible según comprobación');
  });
});
