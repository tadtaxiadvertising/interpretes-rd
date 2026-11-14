// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { InterpreterPatchSchema } from '../api-schemas';

describe('InterpreterPatchSchema without creation defaults', () => {
  it('does not reset status, languages, goals or payment settings on a name-only patch', () => {
    expect(InterpreterPatchSchema.parse({ name: 'Updated Interpreter' }))
      .toEqual({ name: 'Updated Interpreter' });
  });

  it('does not add creation defaults to an empty or status-only patch', () => {
    expect(InterpreterPatchSchema.parse({})).toEqual({});
    expect(InterpreterPatchSchema.parse({ status: 'Inactivo' }))
      .toEqual({ status: 'Inactivo' });
  });

  it('accepts explicit valid changes including false, goals and payment schedule', () => {
    const input = {
      status: 'Training',
      languageA: 'Francés',
      languageB: 'Inglés',
      documentosCompleto: false,
      monthlyGoal: 600,
      paymentFrequency: 'Biweekly',
      paymentDay: '15',
    };
    expect(InterpreterPatchSchema.parse(input)).toEqual(input);
  });

  it('rejects invalid values instead of silently inserting defaults', () => {
    expect(InterpreterPatchSchema.safeParse({ monthlyGoal: -5 }).success).toBe(false);
    expect(InterpreterPatchSchema.safeParse({ status: 'UNKNOWN' }).success).toBe(false);
    expect(InterpreterPatchSchema.safeParse({ paymentFrequency: 'Daily' }).success).toBe(false);
    expect(InterpreterPatchSchema.safeParse({ password: 'short' }).success).toBe(false);
  });
});
