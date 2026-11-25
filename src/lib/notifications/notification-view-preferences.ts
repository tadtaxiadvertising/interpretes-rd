export type NotificationViewPreferences = { openUnread: boolean; prioritizeImportant: boolean };
export const defaultNotificationViewPreferences: NotificationViewPreferences = { openUnread: false, prioritizeImportant: false };

export function parseNotificationViewPreferences(raw: string | null): NotificationViewPreferences {
  try {
    const value = raw ? JSON.parse(raw) : null;
    return { openUnread: value?.openUnread === true, prioritizeImportant: value?.prioritizeImportant === true };
  } catch {
    return { ...defaultNotificationViewPreferences };
  }
}

export function notificationImportance(type: string | null): number {
  return type === 'error' ? 2 : type === 'warning' ? 1 : 0;
}
