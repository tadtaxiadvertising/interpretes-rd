// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  validate: vi.fn(), readiness: vi.fn(), directCatalog: vi.fn(), rollout: vi.fn(), db: {},
}));
vi.mock('@/lib/auth/actions', () => ({ validateAction: mocks.validate }));
vi.mock('@/lib/prisma', () => ({ default: mocks.db }));
vi.mock('@/lib/roleplay/creation-ledger-readiness', () => ({ isCreationLedgerReady: mocks.readiness }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('@/lib/roleplay/direct-upload-catalog-readiness', () => ({ inspectDirectUploadCatalog: mocks.directCatalog }));
vi.mock('@/lib/roleplay/direct-upload-rollout-inspection', () => ({ inspectDirectRolloutMetadata: mocks.rollout }));
import CreationReadinessPage from './page';
import { DIRECT_UPLOAD_FORM_FLAGS, OPENING_ASSIGNMENT_FLAGS } from '@/lib/roleplay/direct-upload-pilot-config';

async function view(check?: string | string[], checkDirect?: string | string[], checkRollout?: string | string[], checkAll?: string | string[]) {
  return renderToStaticMarkup(await CreationReadinessPage({ searchParams: Promise.resolve({ check, checkDirect, checkRollout, checkAll }) }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('ROLEPLAY_CREATION_IDEMPOTENCY_ENABLED', 'false');
  vi.stubEnv('ROLEPLAY_IDEMPOTENCY_RECEIPTS_ENABLED', 'true');
  vi.stubEnv('GIT_SHA', 'a'.repeat(40));
  vi.stubEnv('ROLEPLAY_DIRECT_UPLOAD_RESERVATION_API_ENABLED', 'false');
  mocks.validate.mockResolvedValue({ user: { role: 'admin' } });
  mocks.readiness.mockResolvedValue(true);
  mocks.rollout.mockResolvedValue({
    schemaMetadataReady: false,
    tableChecks: [{ name: 'roleplay_bilingual_openings', state: 'missing' }],
    triggerChecks: [{ table: 'roleplay_bilingual_openings', name: 'roleplay_opening_record_guard', enabled: false }],
    columnChecks: { opening: false, capability: true, releaseGate: true, assignmentHash: true },
    buckets: [{ id: 'roleplay-audio-private', state: 'metadata-ready' }, { id: 'roleplay-opening-private', state: 'review-required' }],
  });
  mocks.directCatalog.mockResolvedValue({ reservation: 'catalog-ready', budget: 'accounting-consistent', permissions: { state: 'recognized', tables: [{ name: 'roleplay_upload_reservations', runtimeAccess: true, privateAccess: true }] }, capacity: { maxSlots: 25, allocatedSlots: 10, remainingSlots: 15 } });
});
afterEach(() => vi.unstubAllEnvs());

describe('admin runtime diagnostic', () => {
  it('places recovery and integral actions before technical details and links to existing tools', async () => {
    vi.stubEnv('ROLEPLAY_DIRECT_UPLOAD_RESERVATION_API_ENABLED', 'true');
    const html = await view();
    expect(html).toContain('href="/admin/roleplays/studio"');
    expect(html).toContain('href="/admin/roleplays/new"');
    expect(html).toContain('href="#saved-reservation-title"');
    const recovery = html.indexOf('id="saved-reservation-title"');
    const integral = html.indexOf('Ejecutar diagnóstico integral');
    const technical = html.indexOf('Detalles técnicos y comprobaciones individuales');
    expect(recovery).toBeGreaterThan(-1);
    expect(recovery).toBeLessThan(integral);
    expect(integral).toBeLessThan(technical);
    expect(html.slice(html.lastIndexOf('<details', technical), technical)).not.toContain(' open=""');
    expect(mocks.readiness).not.toHaveBeenCalled();
    expect(mocks.directCatalog).not.toHaveBeenCalled();
    expect(mocks.rollout).not.toHaveBeenCalled();
  });
  it('keeps technical details collapsed after integral results, but expands individual results', async () => {
    const integral = await view(undefined, undefined, undefined, '1');
    const individual = await view(undefined, '1');
    const openingTag = (html: string) => {
      const marker = html.indexOf('Detalles técnicos y comprobaciones individuales');
      return html.slice(html.lastIndexOf('<details', marker), marker);
    };
    expect(openingTag(integral)).not.toContain(' open=""');
    expect(openingTag(individual)).toContain(' open=""');
    expect(integral.indexOf('Copiar diagnóstico')).toBeLessThan(integral.indexOf('Detalles técnicos y comprobaciones individuales'));
  });
  it.each([undefined, '0', 'true', ['1', '1']])('does not run all probes without a single explicit request (%o)', async checkAll => {
    expect(await view(undefined, undefined, undefined, checkAll)).toContain('Ejecutar diagnóstico integral');
    expect(mocks.readiness).not.toHaveBeenCalled();
    expect(mocks.directCatalog).not.toHaveBeenCalled();
    expect(mocks.rollout).not.toHaveBeenCalled();
  });

  it('runs each probe exactly once in order and summarizes incomplete metadata without activation', async () => {
    const html = await view('1', '1', '1', '1');
    expect(mocks.readiness).toHaveBeenCalledExactlyOnceWith(mocks.db);
    expect(mocks.directCatalog).toHaveBeenCalledExactlyOnceWith(mocks.db);
    expect(mocks.rollout).toHaveBeenCalledExactlyOnceWith(mocks.db);
    expect(mocks.readiness.mock.invocationCallOrder[0]).toBeLessThan(mocks.directCatalog.mock.invocationCallOrder[0]);
    expect(mocks.directCatalog.mock.invocationCallOrder[0]).toBeLessThan(mocks.rollout.mock.invocationCallOrder[0]);
    expect(html).toContain('Repetir diagnóstico integral');
    expect(html).toContain('Verificaciones externas pendientes');
    expect(html).toContain('Activación no autorizada por este diagnóstico.');
    expect(html).toContain('Revisa las tablas, columnas y disparadores pendientes');
    expect(html).toContain('Cupos contables: 10 de 25; restantes: 15');
    expect(html).toContain('Diagnóstico integral:');
  });

  it('reports failed probes independently and never probes for an unauthorized integral request', async () => {
    mocks.readiness.mockResolvedValue(false);
    mocks.rollout.mockResolvedValue(null);
    const html = await view(undefined, undefined, undefined, '1');
    expect(html).toContain('Metadatos no disponibles desde esta conexión');
    expect(html).toContain('Cupos contables: 10 de 25; restantes: 15');
    expect(html).toContain('Revisa los límites, formatos y privacidad de los buckets.');
    for (const probe of [mocks.readiness, mocks.directCatalog, mocks.rollout]) probe.mockClear();
    mocks.validate.mockResolvedValue({ user: { role: 'interpreter' } });
    expect(await view(undefined, undefined, undefined, '1')).not.toContain('Diagnóstico integral');
    for (const probe of [mocks.readiness, mocks.directCatalog, mocks.rollout]) expect(probe).not.toHaveBeenCalled();
  });
  it.each([undefined, '0', 'true', ['1', '1']])('does not inspect rollout metadata without one explicit request (%o)', async checkRollout => {
    expect(await view(undefined, undefined, checkRollout)).toContain('Metadatos sin comprobar');
    expect(mocks.rollout).not.toHaveBeenCalled();
  });
  it('shows recognized bucket metadata and missing opening guards without authorizing activation', async () => {
    const html = await view(undefined, undefined, '1');
    expect(mocks.rollout).toHaveBeenCalledExactlyOnceWith(mocks.db);
    expect(mocks.directCatalog).not.toHaveBeenCalled();
    expect(mocks.readiness).not.toHaveBeenCalled();
    expect(html).toContain('Estructura de publicación y apertura requiere revisión');
    expect(html).toContain('Bucket roleplay-audio-private: Metadatos reconocidos');
    expect(html).toContain('Bucket roleplay-opening-private: Requiere revisión');
    expect(html).toContain('roleplay_opening_record_guard');
    expect(html).toContain('15 MiB por archivo');
    expect(html).toContain('No autorizan activar el piloto');
  });
  it('keeps accounting results if rollout metadata is unavailable and rejects unauthorized probes', async () => {
    mocks.rollout.mockResolvedValue(null);
    const html = await view(undefined, '1', '1');
    expect(html).toContain('Metadatos no disponibles desde esta conexión');
    expect(html).toContain('Cupos contables: 10 de 25; restantes: 15');
    expect(html).toContain('Estructura de publicación y apertura: No disponible');
    mocks.rollout.mockClear();
    mocks.validate.mockResolvedValue({ user: { role: 'interpreter' } });
    expect(await view(undefined, undefined, '1')).not.toContain('Comprobar estructura y buckets');
    expect(mocks.rollout).not.toHaveBeenCalled();
  });
  it.each([undefined, '0', 'true', ['1', '1']])('does not read the direct catalog without one explicit check (%o)', async checkDirect => {
    const html = await view(undefined, checkDirect);
    expect(html).toContain('Catálogo y presupuesto de subida directa');
    expect(html).toContain('Sin comprobar');
    expect(mocks.directCatalog).not.toHaveBeenCalled();
  });

  it('reports accounting capacity separately from runtime Storage readiness', async () => {
    const html = await view(undefined, '1');
    expect(mocks.directCatalog).toHaveBeenCalledExactlyOnceWith(mocks.db);
    expect(mocks.readiness).not.toHaveBeenCalled();
    expect(html).toContain('Estructura reconocida');
    expect(html).toContain('Contabilidad coherente');
    expect(html).toContain('Permisos reconocidos');
    expect(html).toContain('Ver permisos por registro interno');
    expect(html).toContain('roleplay_upload_reservations');
    expect(html).toContain('10 de 25');
    expect(html).toContain('Cupos contables: 10 de 25; restantes: 15');
    expect(html).toContain('no representan espacio libre real');
  });

  it('hides capacity when accounting requires review and never probes for unauthorized visitors', async () => {
    mocks.directCatalog.mockResolvedValue({ reservation: 'catalog-ready', budget: 'review-required', permissions: { state: 'review-required', tables: [{ name: 'roleplay_upload_reservations', runtimeAccess: false, privateAccess: true }] }, capacity: null });
    const html = await view(undefined, '1');
    expect(html).toContain('Requiere revisión');
    expect(html).not.toContain('Cupos contables restantes');
    expect(html).toContain('Requiere revisión de permisos');
    expect(html).toContain('No se informa capacidad contable utilizable');
    mocks.directCatalog.mockClear();
    mocks.validate.mockResolvedValue({ user: { role: 'interpreter' } });
    expect(await view(undefined, '1')).not.toContain('Catálogo y presupuesto de subida directa');
    expect(mocks.directCatalog).not.toHaveBeenCalled();
  });
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
