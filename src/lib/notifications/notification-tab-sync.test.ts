// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyNotificationTabs, subscribeNotificationTabs } from './notification-tab-sync';

const signal = (scope: string, value: string | null = 'changed:v1', storageArea = window.localStorage) =>
  window.dispatchEvent(new StorageEvent('storage', { key: 'notification-refresh:' + scope, newValue: value, storageArea }));

describe('notification tab invalidation', () => {
  beforeEach(() => { vi.useFakeTimers(); window.localStorage.clear(); });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('publishes a transient signal with no notice payload', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem');
    const remove = vi.spyOn(Storage.prototype, 'removeItem');
    notifyNotificationTabs('account-role');
    expect(set).toHaveBeenCalledExactlyOnceWith('notification-refresh:account-role', 'changed:v1');
    expect(remove).toHaveBeenCalledExactlyOnceWith('notification-refresh:account-role');
    expect(window.localStorage.getItem('notification-refresh:account-role')).toBeNull();
  });

  it('isolates account and role scopes and coalesces a burst of valid events', () => {
    const invalidate = vi.fn();
    const unsubscribe = subscribeNotificationTabs('account-admin', invalidate);
    try {
      signal('another-admin');
      signal('account-candidate');
      signal('account-admin', 'arbitrary payload');
      signal('account-admin', null);
      signal('account-admin', 'changed:v1', window.sessionStorage);
      vi.advanceTimersByTime(400);
      expect(invalidate).not.toHaveBeenCalled();
      signal('account-admin');
      signal('account-admin');
      signal('account-admin');
      vi.advanceTimersByTime(349);
      expect(invalidate).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(invalidate).toHaveBeenCalledTimes(1);
    } finally { unsubscribe(); }
  });

  it('defers a hidden tab and consumes the signal when visible again', () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const invalidate = vi.fn();
    const unsubscribe = subscribeNotificationTabs('account', invalidate);
    try {
      signal('account');
      vi.advanceTimersByTime(1000);
      expect(invalidate).not.toHaveBeenCalled();
      visibility.mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(350);
      expect(invalidate).toHaveBeenCalledTimes(1);
    } finally { unsubscribe(); }
  });

  it('cancels a pending signal and removes listeners on unmount', () => {
    const invalidate = vi.fn();
    const unsubscribe = subscribeNotificationTabs('account', invalidate);
    signal('account');
    unsubscribe();
    signal('account');
    vi.advanceTimersByTime(1000);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('does not publish without a scope or interrupt reading when storage is blocked', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    notifyNotificationTabs(undefined);
    expect(set).not.toHaveBeenCalled();
    expect(() => notifyNotificationTabs('account')).not.toThrow();
    const invalidate = vi.fn();
    const unsubscribe = subscribeNotificationTabs(undefined, invalidate);
    signal('account');
    vi.advanceTimersByTime(1000);
    expect(invalidate).not.toHaveBeenCalled();
    unsubscribe();
  });
});
