// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ createMany: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { notification: { createMany: m.createMany } } }));
import { publishNotificationEvent, type NotificationEvent } from './publish-notification-event';

const event: NotificationEvent = {
  userId: '123e4567-e89b-42d3-a456-426614174000',
  eventKey: 'qa.evaluation:42', title: 'QA', message: 'Resultado disponible',
  category: 'qa', type: 'info', link: '/dashboard?token=private',
};

beforeEach(() => { vi.resetAllMocks(); m.createMany.mockResolvedValue({ count: 1 }); });

describe('notification event publication', () => {
  it('reuses the primary key for retries and never overwrites existing rows', async () => {
    m.createMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const first = await publishNotificationEvent(event);
    const second = await publishNotificationEvent({ ...event, message: 'Retry' });
    expect(first.created).toBe(true);
    expect(second).toEqual({ id: first.id, created: false });
    expect(m.createMany).toHaveBeenCalledWith({
      data: [{ id: first.id, userId: event.userId, title: event.title, message: event.message, category: event.category, type: event.type, link: '/dashboard' }],
      skipDuplicates: true,
    });
  });

  it('distinguishes separate events and recipients', async () => {
    const a = await publishNotificationEvent(event);
    const b = await publishNotificationEvent({ ...event, eventKey: 'qa.evaluation:43' });
    const c = await publishNotificationEvent({ ...event, userId: '48fb69c9-2ea0-497b-b599-bfd1845ea812' });
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
  });

  it('drops unsafe destinations', async () => {
    await publishNotificationEvent({ ...event, link: '//external.invalid' });
    expect(m.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ link: null })],
    }));
  });
});
