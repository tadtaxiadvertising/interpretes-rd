// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  denied: null as Response | null,
  guard: vi.fn(),
  query: vi.fn(),
  limit: { success: true } as any,
}));

vi.mock('@/lib/api-auth', () => ({
  guardApiAuth: m.guard,
}));
vi.mock('@/lib/prisma', () => ({
  default: { $queryRaw: m.query },
}));
vi.mock('@/lib/security/rate-limit', () => ({
  RATE_LIMITS: { sessionAccess: {} },
  applyRateLimit: () => m.limit,
  createRateLimitHeaders: () => ({ 'X-RateLimit-Limit': '30' }),
}));

import { GET } from '../route';

const request = () => new NextRequest('http://localhost/api/admin/system-readiness');
const ready = {
  accountHolderName: true,
  roleplayBaseAudioPath: true,
  responseSourceAudioPath: true,
  audioJobSourcePath: true,
  libraryArchiveTable: true,
  roleplayStudioColumns: true,
  roleplayStudioConstraints: true,
  accountPlatformVpnColumns: true,
  accountPlatformVpnPortConstraint: true,
};

describe('GET /api/admin/system-readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.denied = null;
    m.guard.mockResolvedValue(null);
    m.limit = { success: true };
    m.query.mockResolvedValue([ready]);
  });

  it('rejects unauthenticated and non-admin requests before touching the database', async () => {
    m.guard.mockResolvedValueOnce(new Response(
      JSON.stringify({ success: false, code: 'FORBIDDEN', error: 'Forbidden' }),
      { status: 403 },
    ));
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Vary')).toBe('Cookie, Authorization');
    expect(m.guard).toHaveBeenCalledWith(expect.any(Request), 'admin');
    expect(m.query).not.toHaveBeenCalled();
  });

  it('reports a healthy schema without reading participant data', async () => {
    const response = await GET(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, status: 'ready', database: 'reachable', schema: ready });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-RateLimit-Limit')).toBe('30');
    expect(m.query).toHaveBeenCalledOnce();
  });

  it('reports missing critical columns as a non-cacheable readiness failure', async () => {
    m.query.mockResolvedValue([{
      ...ready, accountHolderName: false, libraryArchiveTable: false,
      roleplayStudioColumns: false, roleplayStudioConstraints: false,
    }]);
    const response = await GET(request());
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.status).toBe('schema_mismatch');
    expect(body.schema.accountHolderName).toBe(false);
    expect(body.schema.libraryArchiveTable).toBe(false);
    expect(body.schema.roleplayStudioColumns).toBe(false);
    expect(body.schema.roleplayStudioConstraints).toBe(false);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it.each([
    { accountPlatformVpnColumns: false, accountPlatformVpnPortConstraint: true },
    { accountPlatformVpnColumns: true, accountPlatformVpnPortConstraint: false },
    { accountPlatformVpnColumns: false, accountPlatformVpnPortConstraint: false },
  ])('fails readiness for missing or incompatible VPN schema: %o', async vpn => {
    m.query.mockResolvedValueOnce([{ ...ready, ...vpn }]);

    const response = await GET(request());
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      success: false,
      status: 'schema_mismatch',
      database: 'reachable',
      schema: { ...ready, ...vpn },
    });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('inspects exact nullable VPN column types and validates the real port CHECK, never reads accounts', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    const template = m.query.mock.calls[0][0] as TemplateStringsArray;
    const sql = Array.from(template).join(' ');
    const expectedVpnColumns = [
      'vpn_provider', 'vpn_app', 'vpn_username_hint', 'vpn_secret_ref',
      'vpn_country', 'vpn_region', 'vpn_server', 'vpn_exit_ip',
      'vpn_profile', 'vpn_protocol', 'vpn_port',
    ];
    for (const field of expectedVpnColumns) {
      expect(sql).toContain(field);
    }
    expect(sql).toContain('COUNT(*) = 11');
    expect(sql).toContain("actual.is_nullable = 'YES'");
    expect(sql).toContain('account_platforms_vpn_port_range');
    expect(sql).toContain('convalidated');
    expect(sql).toContain('pg_get_constraintdef');
    expect(sql).toContain('checkvpn_portisnullorvpn_port>=1andvpn_port<=65535');
    expect(sql).not.toMatch(/SELECT\s+\*\s+FROM\s+public\.account_platforms/i);
    expect(m.query).toHaveBeenCalledTimes(1);
  });

  it('only queries schema metadata and checks all five Studio types and four constraints', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    const sql = m.query.mock.calls[0][0] as TemplateStringsArray;
    const queryText = Array.from(sql).join(' ');
    expect(queryText).toContain('roleplayStudioColumns');
    expect(queryText).toContain('roleplayStudioConstraints');
    expect(queryText).toContain('source_end_sec');
    expect(queryText).toContain('roleplay_scenarios_source_time_pair_valid');
    expect(queryText).toContain('information_schema.columns');
    expect(queryText).not.toContain('SELECT * FROM');
  });

  it('does not return or log raw Prisma errors, credentials or injected exception names', async () => {
    const injected = new Error('postgresql://private:PRIVATE_PASSWORD@internal.invalid:5432/db');
    injected.name = 'Bearer PRIVATE_SERVICE_TOKEN';
    m.query.mockRejectedValueOnce(injected);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await GET(request());
      const body = await response.json();
      expect(response.status).toBe(503);
      expect(body).toEqual({ success: false, status: 'unavailable', error: 'Database readiness unavailable' });
      expect(JSON.stringify(body)).not.toContain('PRIVATE_PASSWORD');
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE_|internal\.invalid|postgresql:/);
      expect(log).toHaveBeenCalledWith('[ADMIN_READINESS] database probe failed:', 'Error');
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    } finally {
      log.mockRestore();
    }
  });

  it('rate limits an administrator before running database diagnostics', async () => {
    m.limit = { success: false };
    const response = await GET(request());
    expect(response.status).toBe(429);
    expect(m.query).not.toHaveBeenCalled();
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
