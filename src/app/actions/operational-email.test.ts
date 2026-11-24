// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ validateAction: vi.fn(), sendOperationalMailTest: vi.fn() }));
vi.mock('@/lib/auth/actions', () => ({ validateAction: mocks.validateAction }));
vi.mock('@/lib/email/smtp-test', () => ({ sendOperationalMailTest: mocks.sendOperationalMailTest }));

import { testCorporateSmtp } from './operational-email';

describe('admin SMTP test', () => {
  beforeEach(() => vi.resetAllMocks());

  it('denies unauthorized access before any transport call', async () => {
    mocks.validateAction.mockResolvedValue({ error: 'denied', code: 'UNAUTHORIZED' });
    expect(await testCorporateSmtp()).toBe('unauthorized');
    expect(mocks.validateAction).toHaveBeenCalledWith('admin');
    expect(mocks.sendOperationalMailTest).not.toHaveBeenCalled();
  });

  it('passes no client-controlled recipient or payload', async () => {
    mocks.validateAction.mockResolvedValue({ user: { role: 'admin' } });
    mocks.sendOperationalMailTest.mockResolvedValue('accepted');
    expect(await testCorporateSmtp()).toBe('accepted');
    expect(mocks.sendOperationalMailTest).toHaveBeenCalledWith();
  });

  it('redacts raw transport failures', async () => {
    mocks.validateAction.mockResolvedValue({ user: { role: 'admin' } });
    mocks.sendOperationalMailTest.mockRejectedValue(new Error('private secret'));
    expect(await testCorporateSmtp()).toBe('unconfirmed');
  });
});
