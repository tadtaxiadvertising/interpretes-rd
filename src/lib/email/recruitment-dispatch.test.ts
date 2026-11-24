// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { evaluateDispatch, type DispatchSnapshot } from './dispatch-eligibility';
import { dispatchRecruitmentEmail, type DispatchDependencies } from './recruitment-dispatch';

const now = new Date('2026-11-24T05:00:00Z');
function snapshot(): DispatchSnapshot {
  return {
    event: { id: 'event-1', applicationId: 'app-1', eventType: 'APPLICATION_CREATED', toStatus: 'APPLIED', createdAt: now },
    application: { id: 'app-1', status: 'APPLIED', candidateId: 1, email: 'candidate@example.test' },
    identity: { accountId: 'account-1', candidateId: 1, email: 'candidate@example.test', verified: true, active: true },
  };
}
function fixtures() {
  const load = vi.fn<DispatchDependencies['load']>().mockImplementation(async () => snapshot());
  const claim = vi.fn<DispatchDependencies['claim']>().mockResolvedValue({ eventId: 'event-1', kind: 'application_received' });
  const finish = vi.fn<DispatchDependencies['finish']>().mockResolvedValue(true);
  const send = vi.fn<DispatchDependencies['send']>().mockResolvedValue('accepted');
  return { load, claim, finish, send, now: () => now };
}
describe('recruitment dispatch eligibility', () => {
  it('requires fresh events with matching application and current status', () => {
    expect(evaluateDispatch(snapshot(), now)).toMatchObject({ status: 'eligible', kind: 'application_received' });
    const stale = snapshot();
    stale.event.createdAt = new Date(now.getTime() - 25 * 3600000);
    expect(evaluateDispatch(stale, now)).toEqual({ status: 'expired' });
    const advanced = snapshot();
    advanced.application.status = 'ROLEPLAY_PENDING';
    expect(evaluateDispatch(advanced, now)).toEqual({ status: 'ineligible' });
    const other = snapshot();
    other.application.id = 'wrong-app';
    expect(evaluateDispatch(other, now)).toEqual({ status: 'ineligible' });
  });
  it('rejects missing, inactive, unverified or mismatched account bindings', () => {
    const base = snapshot();
    for (const identity of [null, { ...base.identity!, active: false }, { ...base.identity!, verified: false }, { ...base.identity!, candidateId: 2 }, { ...base.identity!, email: 'other@example.test' }, { ...base.identity!, email: 'candidate@example.test\n' }]) {
      expect(evaluateDispatch({ ...base, identity }, now)).toEqual({ status: 'identity_unverified' });
    }
  });
});
describe('single-event dispatch', () => {
  it('does nothing when disabled', async () => {
    const deps = fixtures();
    expect(await dispatchRecruitmentEmail('event-1', false, deps)).toBe('disabled');
    expect(deps.load).not.toHaveBeenCalled();
    expect(deps.send).not.toHaveBeenCalled();
  });
  it('does not send when no claim was won', async () => {
    const deps = fixtures();
    deps.claim.mockResolvedValue(null);
    expect(await dispatchRecruitmentEmail('event-1', true, deps)).toBe('not_claimed');
    expect(deps.send).not.toHaveBeenCalled();
  });
  it('rechecks identity after claiming and cancels if it changed', async () => {
    const deps = fixtures();
    deps.load.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce({ ...snapshot(), identity: null });
    expect(await dispatchRecruitmentEmail('event-1', true, deps)).toBe('cancelled');
    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.finish).toHaveBeenCalledWith('event-1', 'cancelled');
  });
  it('rejects replacement of the bound account after claiming', async () => {
    const deps = fixtures();
    const changed = snapshot();
    changed.identity = { ...changed.identity!, accountId: 'different-account' };
    deps.load.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(changed);
    expect(await dispatchRecruitmentEmail('event-1', true, deps)).toBe('cancelled');
    expect(deps.send).not.toHaveBeenCalled();
  });
  it('cancels when the same account changes email after claiming', async () => {
    const deps = fixtures();
    const changed = snapshot();
    changed.application.email = 'new@example.test';
    changed.identity = { ...changed.identity!, email: 'new@example.test' };
    deps.load.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(changed);
    expect(await dispatchRecruitmentEmail('event-1', true, deps)).toBe('cancelled');
    expect(deps.send).not.toHaveBeenCalled();
  });
  it('sends approved content to the verified recipient exactly once', async () => {
    const deps = fixtures();
    expect(await dispatchRecruitmentEmail('event-1', true, deps)).toBe('accepted');
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(deps.send).toHaveBeenCalledWith(expect.objectContaining({ recipient: 'candidate@example.test', subject: expect.stringContaining('Intérpretes RD') }));
    expect(deps.finish).toHaveBeenCalledWith('event-1', 'accepted');
  });
  it('does not retry an ambiguous SMTP error', async () => {
    const deps = fixtures();
    deps.send.mockRejectedValue(new Error('private provider error'));
    expect(await dispatchRecruitmentEmail('event-1', true, deps)).toBe('unconfirmed');
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(deps.finish).toHaveBeenCalledWith('event-1', 'unconfirmed');
  });
  it('reports a failed final write without resending', async () => {
    const deps = fixtures();
    deps.finish.mockResolvedValue(false);
    expect(await dispatchRecruitmentEmail('event-1', true, deps)).toBe('reconciliation_required');
    expect(deps.send).toHaveBeenCalledTimes(1);
  });
});
