// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  default: {
    $transaction: vi.fn(),
    qAScore: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));
vi.mock('@/lib/api-auth', () => ({ guardApiAuth: vi.fn() }));

import prisma from '@/lib/prisma';
import { guardApiAuth } from '@/lib/api-auth';
import { DELETE, GET, PATCH } from '../route';

const params = { params: Promise.resolve({ id: '8' }) };
const score = {
  id: 8, protocolScore: 90, interpretationScore: 90, languageScore: 90,
  serviceScore: 90, technicalScore: 90, criticalError: false,
  interpreter: { name: 'Sensitive interpreter' },
  productionLog: { id: 22 },
  totalScore: 90,
};
const req = () => new Request('http://localhost/api/v1/qa/8');
const patch = (body: unknown) => new Request('http://localhost/api/v1/qa/8', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const remove = () => new Request('http://localhost/api/v1/qa/8', { method: 'DELETE' });

function privateResponse(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  for (const field of ['Authorization', 'Cookie', 'Origin']) {
    expect(response.headers.get('Vary')).toContain(field);
  }
}

describe('QA detail API privacy and error isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(guardApiAuth).mockResolvedValue(null);
    vi.mocked(prisma.qAScore.findUnique).mockResolvedValue(score as never);
    vi.mocked(prisma.qAScore.update).mockResolvedValue(score as never);
    vi.mocked(prisma.qAScore.delete).mockResolvedValue(score as never);
    vi.mocked(prisma.$transaction).mockImplementation(
      (async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma)) as never,
    );
  });

  it.each([
    ['GET', GET, req],
    ['PATCH', PATCH, () => patch({ comentarios: 'Synthetic QA review' })],
    ['DELETE', DELETE, remove],
  ])('%s denies non-admin requests before database access', async (_method, handler, request) => {
    vi.mocked(guardApiAuth).mockResolvedValueOnce(
      Response.json({ success: false, error: 'Forbidden' }, { status: 403 }) as never,
    );
    const response = await handler(request(), params);
    expect(response.status).toBe(403);
    privateResponse(response);
    expect(prisma.qAScore.findUnique).not.toHaveBeenCalled();
    expect(prisma.qAScore.update).not.toHaveBeenCalled();
    expect(prisma.qAScore.delete).not.toHaveBeenCalled();
  });

  it('returns private GET details and private not-found errors', async () => {
    const result = await GET(req(), params);
    expect(result.status).toBe(200);
    privateResponse(result);
    expect((await result.json()).interpreter.name).toBe('Sensitive interpreter');

    vi.mocked(prisma.qAScore.findUnique).mockResolvedValueOnce(null);
    const notFound = await GET(req(), params);
    expect(notFound.status).toBe(404);
    privateResponse(notFound);
  });

  it('keeps both successful and invalid PATCH responses private', async () => {
    const response = await PATCH(patch({ comentarios: 'Synthetic QA review' }), params);
    expect(response.status).toBe(200);
    privateResponse(response);
    expect(prisma.qAScore.update).toHaveBeenCalledOnce();
    // Metadata PATCH must not modify historical scores, critical flags or
    // audit ownership, even if a previously stored result was inconsistent.
    expect(prisma.qAScore.update).toHaveBeenCalledWith({
      where: { id: 8 }, data: { comentarios: 'Synthetic QA review' },
    });

    const invalid = await PATCH(patch({ protocolScore: 999 }), params);
    expect(invalid.status).toBe(400);
    privateResponse(invalid);
    expect(prisma.qAScore.update).toHaveBeenCalledOnce();
  });

  it('returns private DELETE success and idempotent-not-found responses', async () => {
    const response = await DELETE(remove(), params);
    expect(response.status).toBe(200);
    privateResponse(response);

    vi.mocked(prisma.qAScore.delete).mockRejectedValueOnce({ code: 'P2025' });
    const absent = await DELETE(remove(), params);
    expect(absent.status).toBe(404);
    privateResponse(absent);
  });

  it.each([
    ['GET', GET, req, 'findUnique', 'Error fetching scorecard:', 'Error fetching scorecard'],
    ['PATCH', PATCH, () => patch({ comentarios: 'Synthetic QA review' }), 'update', 'QA PATCH ERROR:', 'Error updating scorecard'],
    ['DELETE', DELETE, remove, 'delete', 'Error deleting scorecard:', 'Error deleting scorecard'],
  ] as const)('%s redacts provider errors from HTTP and server logs', async (
    _name, handler, request, failureMethod, logLabel, fallback,
  ) => {
    vi.mocked(prisma.qAScore[failureMethod]).mockRejectedValueOnce(
      new Error('postgresql://admin:PRIVATE_PASSWORD@db.internal/qa'),
    );
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await handler(request(), params);
      expect(response.status).toBe(500);
      privateResponse(response);
      expect(await response.json()).toEqual({ success: false, error: fallback });
      expect(spy).toHaveBeenCalledWith(logLabel, 'Error');
      expect(JSON.stringify(spy.mock.calls)).not.toMatch(/PRIVATE_PASSWORD|db\.internal|postgresql:/);
    } finally { spy.mockRestore(); }
  });

  it('does not reveal a malicious exception name or custom error object', async () => {
    const thrown = new Error('PRIVATE_PASSWORD');
    thrown.name = 'Bearer PRIVATE_TOKEN';
    vi.mocked(prisma.qAScore.findUnique).mockRejectedValueOnce(thrown);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await GET(req(), params);
      expect(result.status).toBe(500);
      expect(JSON.stringify(await result.json())).not.toContain('PRIVATE_');
      expect(JSON.stringify(spy.mock.calls)).not.toMatch(/PRIVATE_|Bearer /);
    } finally { spy.mockRestore(); }
  });
  it('rejects empty edits and direct attempts to change total or audit linkage', async () => {
    for (const body of [
      {}, { totalScore: 100 }, { interpreterId: 55 }, { productionLogId: 44 },
    ]) {
      const response = await PATCH(patch(body), params);
      expect(response.status).toBe(400);
      privateResponse(response);
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.qAScore.update).not.toHaveBeenCalled();
  });

  it('accepts canonical 0–100 dimensions and recomputes the score only for score edits', async () => {
    vi.mocked(prisma.qAScore.update).mockResolvedValueOnce({
      ...score, protocolScore: 100, totalScore: 92,
    } as never);
    const response = await PATCH(patch({ protocolScore: 100 }), params);
    expect(response.status).toBe(200);
    privateResponse(response);
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.qAScore.update).toHaveBeenCalledWith({
      where: { id: 8 },
      data: { protocolScore: 100, totalScore: 92 },
    });
  });

  it('preserves criticalError when a PATCH edits only comments', async () => {
    vi.mocked(prisma.qAScore.findUnique).mockResolvedValueOnce({
      ...score, criticalError: true, totalScore: 0,
    } as never);
    vi.mocked(prisma.qAScore.update).mockResolvedValueOnce({
      ...score, criticalError: true, totalScore: 0,
    } as never);
    const response = await PATCH(patch({ comentarios: 'Comentario actualizado' }), params);
    expect(response.status).toBe(200);
    expect(prisma.qAScore.update).toHaveBeenCalledWith({
      where: { id: 8 }, data: { comentarios: 'Comentario actualizado' },
    });
  });

  it('forces zero when an administrator explicitly marks a critical error', async () => {
    vi.mocked(prisma.qAScore.update).mockResolvedValueOnce({
      ...score, criticalError: true, totalScore: 0,
    } as never);
    const response = await PATCH(patch({ criticalError: true }), params);
    expect(response.status).toBe(200);
    expect(prisma.qAScore.update).toHaveBeenCalledWith({
      where: { id: 8 },
      data: { criticalError: true, totalScore: 0, accionRequerida: 'Advertencia' },
    });
  });

  it('rejects a database trigger that rewrites a historical total on a comments-only PATCH', async () => {
    vi.mocked(prisma.qAScore.update).mockResolvedValueOnce({
      ...score, totalScore: 26,
    } as never);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await PATCH(patch({ comentarios: 'Solo comentario' }), params);
      expect(response.status).toBe(500);
      privateResponse(response);
      expect(await response.json()).toEqual({ success: false, error: 'Error updating scorecard' });
      expect(spy).toHaveBeenCalledWith('QA PATCH ERROR:', 'Error');
    } finally { spy.mockRestore(); }
  });

  it('rejects a database trigger that overwrites a freshly recalculated QA total', async () => {
    vi.mocked(prisma.qAScore.update).mockResolvedValueOnce({
      ...score, protocolScore: 100, totalScore: 26,
    } as never);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await PATCH(patch({ protocolScore: 100 }), params);
      expect(response.status).toBe(500);
      privateResponse(response);
      expect(await response.json()).toEqual({ success: false, error: 'Error updating scorecard' });
    } finally { spy.mockRestore(); }
  });

  it('does not update a nonexistent scorecard', async () => {
    vi.mocked(prisma.qAScore.findUnique).mockResolvedValueOnce(null);
    const response = await PATCH(patch({ comentarios: 'Una nota' }), params);
    expect(response.status).toBe(404);
    privateResponse(response);
    expect(prisma.qAScore.update).not.toHaveBeenCalled();
  });

});
