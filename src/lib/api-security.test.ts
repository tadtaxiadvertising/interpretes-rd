// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { withSecurity } from './api-security';

function req(query = '') {
  return new NextRequest('http://localhost/api/v1/payroll' + query);
}
function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError(
    'postgresql://private:PRIVATE_PASSWORD@internal.invalid/schema',
    { code, clientVersion: '7.10.1' },
  );
}

describe('shared API security wrapper: private error boundaries', () => {
  it('does not expose or log database messages, stacks, or manipulated names', async () => {
    const error = prismaError('P2022');
    error.name = 'Bearer PRIVATE_AUTH_TOKEN';
    const handler = withSecurity(async () => { throw error; });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await handler(req(), undefined);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ success: false, error: 'Internal Server Error' });
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      expect(res.headers.get('Vary')).toContain('Authorization');
      expect(JSON.stringify(spy.mock.calls)).not.toMatch(/PRIVATE_|postgresql:|internal\.invalid/);
      expect(spy).toHaveBeenCalledWith('[SECURITY-AUDIT] API handler failure:', 'Error');
    } finally {
      spy.mockRestore();
    }
  });

  it.each(['P2002', 'P2003', 'P2025'])('retains the established conflict status for Prisma code %s', async (code) => {
    const handler = withSecurity(async () => { throw prismaError(code); });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await handler(req(), undefined);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        success: false, error: 'Database conflict or constraint violation',
      });
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    } finally {
      spy.mockRestore();
    }
  });

  it.each(['P2022', 'P1011', 'P9999'])('returns a generic 500 for non-conflict Prisma code %s', async (code) => {
    const handler = withSecurity(async () => { throw prismaError(code); });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await handler(req(), undefined);
      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe('Internal Server Error');
    } finally {
      spy.mockRestore();
    }
  });

  it('retains the Zod 400 contract but never reflects raw exception messages', async () => {
    const downstream = vi.fn(async () => NextResponse.json({ success: true }));
    const handler = withSecurity(downstream, {
      query: z.object({ limit: z.coerce.number().int().min(1) }),
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await handler(req('?limit=not-a-number'), undefined);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('Bad Request: Validation failed');
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      expect(downstream).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('does not change successful responses from authorized handlers', async () => {
    const downstream = vi.fn(async () => NextResponse.json({ success: true, count: 1 }));
    const handler = withSecurity(downstream);
    const res = await handler(req(), undefined);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, count: 1 });
    expect(downstream).toHaveBeenCalledOnce();
  });
});
