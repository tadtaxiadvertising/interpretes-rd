import { describe, expect, it } from 'vitest';
import {
  publicRoleplayActionError,
  roleplayBusinessError,
  ROLEPLAY_BUSINESS_FAILURE_CODES,
} from './action-errors';

describe('Roleplay action errors: explicit business rules only', () => {
  it.each(Object.entries(ROLEPLAY_BUSINESS_FAILURE_CODES))(
    'exposes the documented business rule %s with code %s',
    (message, code) => {
      const failure = roleplayBusinessError(message as keyof typeof ROLEPLAY_BUSINESS_FAILURE_CODES);
      expect(publicRoleplayActionError(failure, 'Generic failure')).toEqual({ error: message, code });
    },
  );

  it.each([
    new Error('Unauthorized'),
    new Error('Session not found'),
    new Error('Roleplay was already submitted or changed'),
    new Error('Concurrent evaluation detected or session not available'),
    { message: 'Unauthorized', code: 'FORBIDDEN' },
    { name: 'RoleplayBusinessError', message: 'Session already evaluated', code: 'CONFLICT' },
    'Session already evaluated',
    null,
  ])('never trusts arbitrary provider errors with business-rule text (%s)', (error) => {
    expect(publicRoleplayActionError(error, 'No fue posible completar la acción')).toEqual({
      error: 'No fue posible completar la acción',
      code: 'INTERNAL_ERROR',
    });
  });

  it('never exposes a connection URL, signed audio path or provider token', () => {
    const error = new Error('postgresql://private:PRIVATE_PASSWORD@db.invalid');
    error.name = 'RoleplayBusinessError';
    error.stack = 'storage://PRIVATE_AUDIO_PATH?token=PRIVATE_STORAGE_TOKEN';
    const result = publicRoleplayActionError(error, 'Please retry later');
    expect(result).toEqual({ error: 'Please retry later', code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|postgresql:|storage:/);
  });
});
