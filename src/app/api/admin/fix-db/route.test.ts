// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const m = vi.hoisted(() => ({
  guardApiAuth: vi.fn(),
  executeRawUnsafe: vi.fn(),
  queryRawUnsafe: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ guardApiAuth: m.guardApiAuth }));
vi.mock('@/lib/prisma', () => ({
  default: { $executeRawUnsafe: m.executeRawUnsafe, $queryRawUnsafe: m.queryRawUnsafe },
}));

import { GET } from './route';

const request = () => new Request('http://localhost/api/admin/fix-db', { method: 'GET' });

describe('legacy GET /api/admin/fix-db', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.guardApiAuth.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never executes SQL even for an authorized administrator', async () => {
    const response = await GET(request());
    expect(response.status).toBe(410);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Vary')).toContain('Cookie');
    expect(await response.json()).toEqual({
      success: false,
      code: 'SCHEMA_PATCH_ENDPOINT_RETIRED',
      error: 'Database schema changes are managed by versioned migrations.',
    });
    expect(m.guardApiAuth).toHaveBeenCalledWith(expect.any(Request), 'admin');
    expect(m.executeRawUnsafe).not.toHaveBeenCalled();
    expect(m.queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('preserves the admin authentication gate and never accesses the database for rejected callers', async () => {
    m.guardApiAuth.mockResolvedValue(NextResponse.json({
      success: false, code: 'FORBIDDEN', error: 'Forbidden',
    }, { status: 403 }));
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(m.executeRawUnsafe).not.toHaveBeenCalled();
    expect(m.queryRawUnsafe).not.toHaveBeenCalled();
  });
});
