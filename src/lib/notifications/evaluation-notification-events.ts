import type { NotificationEvent } from './notification-event-row';

type Evaluation = { totalScore: number; actionRequired: string };

export function qaEvaluationEvent(userId: string, input: Evaluation & { evaluationId: number }): NotificationEvent {
  const score = input.totalScore;
  return {
    userId, eventKey: 'qa.evaluation:' + input.evaluationId, category: 'qa',
    title: 'Evaluación QA Lista',
    message: `Tu puntaje de sesión: ${score.toFixed(1)}%. Acción: ${input.actionRequired}`,
    type: score >= 85 ? 'success' : score >= 70 ? 'info' : 'warning',
    link: '/dashboard',
  };
}

export function roleplayEvaluationEvent(userId: string, input: Evaluation & { sessionId: string; passed: boolean }): NotificationEvent {
  return {
    userId, eventKey: 'roleplay.evaluated:' + input.sessionId,
    category: 'roleplay', type: input.passed ? 'success' : 'warning',
    title: 'Roleplay evaluado',
    message: `Tu roleplay fue evaluado: ${input.totalScore.toFixed(1)}%. Acción: ${input.actionRequired}`,
    link: '/dashboard/roleplays',
  };
}
