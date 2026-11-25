import type { NotificationEvent } from './notification-event-row';

export function roleplayAssignmentEvent(userId: string, sessionId: string): NotificationEvent {
  return {
    userId, eventKey: 'roleplay.assigned:' + sessionId,
    category: 'roleplay', type: 'info', title: 'Nuevo roleplay asignado',
    message: 'Tienes un ejercicio disponible en Mis Roleplays.',
    link: '/dashboard/roleplays',
  };
}

export function messageReceivedEvent(userId: string, messageId: string, role: string | null): NotificationEvent {
  return {
    userId, eventKey: 'messaging.message:' + messageId,
    category: 'messaging', type: 'info', title: 'Nuevo mensaje',
    message: 'Tienes un nuevo mensaje en tu bandeja de entrada.',
    link: role?.toLowerCase() === 'admin' ? '/admin/messages' : '/dashboard/messages',
  };
}
