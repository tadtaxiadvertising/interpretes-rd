import { describe, expect, it } from 'vitest';
import { environmentBudgetProvider } from './environment-budget-provider';

describe('environment budget provider attribution', () => {
  it.each([
    ['in-v3.mailjet.com', 'mailjet'],
    [' MAIL.SMTP2GO.COM ', 'smtp2go'],
    ['smtp.mailersend.net', 'mailersend'],
  ] as const)('matches catalog SMTP host %s', (host, expected) => {
    expect(environmentBudgetProvider('smtp', host)).toBe(expected);
  });

  it.each(['mail.smtp2go.com.example.test', 'smtp2go.com', 'https://mail.smtp2go.com', 'mail.smtp2go.com:587', 'unknown.example.test', '', undefined, null])('does not guess a provider for %s', host => {
    expect(environmentBudgetProvider('smtp', host)).toBeNull();
  });

  it('preserves explicit API identities regardless of SMTP host', () => {
    expect(environmentBudgetProvider('brevo', 'smtp.mailersend.net')).toBe('brevo');
    expect(environmentBudgetProvider('resend', 'mail.smtp2go.com')).toBe('resend');
    expect(environmentBudgetProvider('invalid', 'mail.smtp2go.com')).toBeNull();
  });
});
