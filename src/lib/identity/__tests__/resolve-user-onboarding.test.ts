import { describe, expect, it } from 'vitest';
import { computeOnboardingStatus } from '@/lib/identity/resolve-user';

const profile = {
  onboardingComplete: false,
  termsAcceptedAt: null,
  bankName: null,
  bankAccount: null,
  bankCedula: null,
  bankAccountType: null,
  signatureDate: null,
};

const interpreter = {
  documentosCompleto: true,
  banco: 'Banco de Prueba',
  cuentaPago: '123456789',
  tipoCuenta: 'Ahorro',
  cedulaRnc: '001-1234567-8',
  notas: '[TERMS_ACCEPTED] signed',
};

describe('Auth.js onboarding state consistency', () => {
  it('does not mark legacy completed profiles complete when banking details are missing', () => {
    const result = computeOnboardingStatus(
      profile,
      { ...interpreter, cuentaPago: null },
      true,
    );

    expect(result).toEqual({
      status: 'NEEDS_REVIEW',
      step: 'banking',
      version: 1,
      completedAt: null,
    });
  });

  it('requires account type as part of complete banking details', () => {
    const result = computeOnboardingStatus(
      profile,
      { ...interpreter, tipoCuenta: null },
      true,
    );

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.step).toBe('banking');
  });

  it('does not fabricate a completion timestamp for legacy Auth.js records', () => {
    const result = computeOnboardingStatus(profile, interpreter, true);

    expect(result.status).toBe('COMPLETED');
    expect(result.completedAt).toBeNull();
  });

  it('keeps the next step resumable when terms exist but banking is incomplete', () => {
    const result = computeOnboardingStatus(
      profile,
      { ...interpreter, documentosCompleto: false, banco: null, notas: '[TERMS_ACCEPTED]' },
      true,
    );

    expect(result.status).toBe('IN_PROGRESS');
    expect(result.step).toBe('banking');
  });
});
