import { describe, expect, it } from 'vitest';
import { clientAssignmentSchema, clientInputSchema } from './client-validation';

describe('clientInputSchema', () => {
  it('trims and accepts a valid client', () => {
    expect(clientInputSchema.parse({
      name: '  Acme Support  ', legalName: '', contactName: '',
      contactEmail: '', phone: '', notes: '',
    }).name).toBe('Acme Support');
  });

  it('rejects blank names and malformed contact emails', () => {
    expect(clientInputSchema.safeParse({
      name: ' ', legalName: '', contactName: '',
      contactEmail: '', phone: '', notes: '',
    }).success).toBe(false);
    expect(clientInputSchema.safeParse({
      name: 'Valid Client', legalName: '', contactName: '',
      contactEmail: 'not-an-email', phone: '', notes: '',
    }).success).toBe(false);
  });
});

describe('clientAssignmentSchema', () => {
  it('accepts positive account and client IDs', () => {
    expect(clientAssignmentSchema.safeParse({ accountId: '2', clientId: '4' }).success).toBe(true);
  });

  it('rejects zero and non-numeric IDs', () => {
    expect(clientAssignmentSchema.safeParse({ accountId: '0', clientId: '4' }).success).toBe(false);
    expect(clientAssignmentSchema.safeParse({ accountId: 'x', clientId: '4' }).success).toBe(false);
  });
});
