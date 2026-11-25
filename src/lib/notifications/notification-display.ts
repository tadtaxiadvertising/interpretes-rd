export const notificationCategories = ['system', 'qa', 'messaging', 'roleplay', 'recruitment', 'operations', 'finance'] as const;
export type NotificationCategory = typeof notificationCategories[number];

const labels: Record<NotificationCategory, string> = {
  system: 'Sistema', qa: 'Calidad (QA)', messaging: 'Mensajería',
  roleplay: 'Roleplays', recruitment: 'Reclutamiento', operations: 'Operaciones', finance: 'Finanzas',
};

export function publicNotificationCategory(value: unknown): NotificationCategory {
  return notificationCategories.find(category => category === value) ?? 'system';
}

export function notificationCategoryLabel(value: unknown): string {
  return labels[publicNotificationCategory(value)];
}

export function notificationSeverityLabel(type: string | null): string {
  switch (type) {
    case 'error': return 'Importante';
    case 'warning': return 'Atención';
    case 'success': return 'Confirmación';
    default: return 'Información';
  }
}
