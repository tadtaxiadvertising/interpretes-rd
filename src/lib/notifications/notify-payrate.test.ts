// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ find: vi.fn(), publish: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { userProfile: { findUnique: m.find } } }));
vi.mock('./publish-notification-event', () => ({ publishNotificationEvent: m.publish }));
import { notifyPayrateChange } from './notify-payrate';
const id = '123e4567-e89b-42d3-a456-426614174000';
beforeEach(() => { vi.resetAllMocks(); m.find.mockResolvedValue({ id, role: 'interpreter' }); });

describe('finance rate notices', () => {
  it('uses the linked profile and the committed audit identifier without revealing amounts', async () => {
    await notifyPayrateChange({ interpreterId: 7, auditId: 42, kind: 'general' });
    expect(m.find).toHaveBeenCalledExactlyOnceWith({ where: { interpreterId: 7 }, select: { id: true, role: true } });
    expect(m.publish).toHaveBeenCalledExactlyOnceWith({ userId: id, eventKey: 'finance.payrate.changed:42', category: 'finance', type: 'info', title: 'Tarifa general actualizada', message: 'Se ha actualizado una de tus tarifas. Consulta tus ingresos y pagos para revisar el valor vigente.', link: '/dashboard/earnings' });
  });
  it.each([null, { id, role: 'admin' }, { id, role: 'candidate' }, { id: 'invalid', role: 'interpreter' }])('skips invalid recipient %j', async profile => {
    m.find.mockResolvedValueOnce(profile);
    await notifyPayrateChange({ interpreterId: 7, auditId: 42, kind: 'special' });
    expect(m.publish).not.toHaveBeenCalled();
  });
  it('rejects invalid audit identifiers before lookup', async () => {
    await notifyPayrateChange({ interpreterId: 7, auditId: 0, kind: 'general' });
    expect(m.find).not.toHaveBeenCalled();
  });
  it('does not throw or log private exception data after a delivery failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      m.publish.mockRejectedValueOnce(new Error('PRIVATE_PASSWORD'));
      await expect(notifyPayrateChange({ interpreterId: 7, auditId: 42, kind: 'special' })).resolves.toBeUndefined();
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_PASSWORD');
    } finally { warn.mockRestore(); }
  });
});
