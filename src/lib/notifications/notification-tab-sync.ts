const SIGNAL = 'changed:v1';
const DELAY_MS = 350;

function signalKey(scope: string) {
  return 'notification-refresh:' + scope;
}

/** Notify sibling tabs after a confirmed server write. No notification data is stored. */
export function notifyNotificationTabs(scope: string | undefined) {
  if (!scope) return;
  try {
    const key = signalKey(scope);
    window.localStorage.setItem(key, SIGNAL);
    window.localStorage.removeItem(key);
  } catch {
    // Storage may be unavailable. The regular authorized refresh still works.
  }
}

/** Coalesce bursts and defer hidden tabs until visible; never trust browser data as a read receipt. */
export function subscribeNotificationTabs(scope: string | undefined, onInvalidate: () => void): () => void {
  if (!scope) return () => {};
  let storage: Storage;
  try { storage = window.localStorage; } catch { return () => {}; }

  const key = signalKey(scope);
  let pending = false;
  let timer: number | undefined;
  const schedule = () => {
    if (!pending || timer !== undefined || document.visibilityState === 'hidden') return;
    timer = window.setTimeout(() => {
      timer = undefined;
      if (document.visibilityState === 'hidden') return;
      pending = false;
      onInvalidate();
    }, DELAY_MS);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea !== storage || event.key !== key || event.newValue !== SIGNAL) return;
    pending = true;
    schedule();
  };
  window.addEventListener('storage', onStorage);
  document.addEventListener('visibilitychange', schedule);
  return () => {
    window.removeEventListener('storage', onStorage);
    document.removeEventListener('visibilitychange', schedule);
    if (timer !== undefined) window.clearTimeout(timer);
  };
}
