/**
 * Public Roleplay action failures must originate from an explicit business
 * rule, never from arbitrary Prisma, Storage or provider Error.message text.
 */
export const ROLEPLAY_BUSINESS_FAILURE_CODES = {
  'Unauthorized': 'FORBIDDEN',
  'Session not available for submission': 'INVALID_STATE',
  'A valid uploaded audio object is required before confirming the response': 'INVALID_STATE',
  'Response already recorded for this scenario': 'CONFLICT',
  'Concurrent submission detected': 'CONFLICT',
  'Session not available for self-assessment': 'INVALID_STATE',
  'This scenario is not the current step': 'INVALID_STATE',
  'Confirm your recording before completing the self-assessment': 'INVALID_STATE',
  'This self-assessment has already been submitted': 'CONFLICT',
  'Roleplay is not ready to submit': 'INVALID_STATE',
  'Complete every recording and self-assessment before submitting': 'INVALID_STATE',
  'Roleplay was already submitted or changed': 'CONFLICT',
  'Session not found': 'NOT_FOUND',
  'Session already evaluated': 'CONFLICT',
  'No response submitted yet': 'INVALID_STATE',
  'Complete every recording and self-assessment before evaluating': 'INVALID_STATE',
  'Concurrent evaluation detected or session not available': 'CONFLICT',
} as const;

type RoleplayBusinessMessage = keyof typeof ROLEPLAY_BUSINESS_FAILURE_CODES;

export class RoleplayBusinessError extends Error {
  readonly code: (typeof ROLEPLAY_BUSINESS_FAILURE_CODES)[RoleplayBusinessMessage];

  constructor(message: RoleplayBusinessMessage) {
    super(message);
    this.name = 'RoleplayBusinessError';
    this.code = ROLEPLAY_BUSINESS_FAILURE_CODES[message];
  }
}

export function roleplayBusinessError(message: RoleplayBusinessMessage): RoleplayBusinessError {
  return new RoleplayBusinessError(message);
}

export function publicRoleplayActionError(error: unknown, fallback: string): {
  error: string;
  code: string;
} {
  // Exact class identity matters. An arbitrary provider exception that happens
  // to use "Unauthorized" or "Session not found" must not become a business
  // error or change the code returned to the caller.
  if (error instanceof RoleplayBusinessError) {
    return { error: error.message, code: error.code };
  }
  return { error: fallback, code: 'INTERNAL_ERROR' };
}
