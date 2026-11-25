// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { emailKindForEvent, type EmailEvent } from './recruitment-event-policy';
import { enqueueRecruitmentEmail, claimRecruitmentEmail, finishRecruitmentEmail } from './recruitment-delivery-ledger';

const event: EmailEvent = { id: 'event-1', applicationId: 'application-1', eventType: 'APPLICATION_CREATED', toStatus: 'APPLIED' };
type Db = Parameters<typeof enqueueRecruitmentEmail>[0];

function mockDb() {
  const findUnique = vi.fn().mockResolvedValue(event);
  const execute = vi.fn().mockResolvedValue(1);
  const query = vi.fn().mockResolvedValue([{ eventId: event.id, kind: 'application_received' }]);
  const db = { recruitmentEvent: { findUnique }, $executeRaw: execute, $queryRaw: query } as unknown as Db;
  return { db, findUnique, execute, query };
}

describe('recruitment email event policy', () => {
  it('accepts only the selected event and status combinations', () => {
    expect(emailKindForEvent(event)).toBe('application_received');
    expect(emailKindForEvent({ ...event, eventType: 'INDUCTION_COMPLETED', toStatus: 'ROLEPLAY_PENDING' })).toBe('roleplay_ready');
    expect(emailKindForEvent({ ...event, eventType: 'ROLEPLAY_PASSED', toStatus: 'INTERVIEW_PENDING' })).toBe('interview_pending');
    expect(emailKindForEvent({ ...event, eventType: 'ROLEPLAY_FAILED', toStatus: 'ROLEPLAY_PENDING' })).toBeNull();
    expect(emailKindForEvent({ ...event, toStatus: 'REJECTED' })).toBeNull();
    expect(emailKindForEvent({ ...event, id: '' })).toBeNull();
  });
});

describe('recruitment email ledger persistence contract', () => {
  it('reads the persisted event and treats a unique-key conflict as a duplicate', async () => {
    const { db, findUnique, execute } = mockDb();
    expect(await enqueueRecruitmentEmail(db, event.id)).toBe('queued');
    expect(findUnique).toHaveBeenCalledWith({ where: { id: event.id }, select: { id: true, applicationId: true, eventType: true, toStatus: true } });
    expect(execute.mock.calls[0][0].join('?')).toContain('ON CONFLICT (event_id) DO NOTHING');
    expect(execute.mock.calls[0].slice(1)).toEqual([event.id, 'application_received']);
    execute.mockResolvedValueOnce(0);
    expect(await enqueueRecruitmentEmail(db, event.id)).toBe('duplicate');
  });

  it('does not insert missing or ineligible events', async () => {
    const { db, findUnique, execute } = mockDb();
    findUnique.mockResolvedValueOnce(null);
    expect(await enqueueRecruitmentEmail(db, event.id)).toBe('ineligible');
    findUnique.mockResolvedValueOnce({ ...event, eventType: 'REJECTED', toStatus: 'REJECTED' });
    expect(await enqueueRecruitmentEmail(db, event.id)).toBe('ineligible');
    expect(execute).not.toHaveBeenCalled();
  });

  it('claims only pending rows and reports lost races', async () => {
    const { db, query } = mockDb();
    expect(await claimRecruitmentEmail(db, event.id, 'brevo')).toEqual({ eventId: event.id, kind: 'application_received' });
    expect(query.mock.calls[0][0].join('?')).toContain("AND status = 'pending'");
    expect(query.mock.calls[0][0].join('?')).toContain('provider = ?');
    expect(query.mock.calls[0].slice(1)).toEqual(['brevo', event.id]);
    query.mockResolvedValueOnce([]);
    expect(await claimRecruitmentEmail(db, event.id, 'brevo')).toBeNull();
  });

  it('records uncertain acceptance without resetting a sending row to pending', async () => {
    const { db, execute } = mockDb();
    expect(await finishRecruitmentEmail(db, event.id, 'unconfirmed')).toBe(true);
    expect(execute.mock.calls[0][0].join('?')).toContain("AND status = 'sending'");
    expect(execute.mock.calls[0].slice(1)).toEqual(['unconfirmed', event.id]);
    execute.mockResolvedValueOnce(0);
    expect(await finishRecruitmentEmail(db, event.id, 'accepted')).toBe(false);
  });
});
