/** Public metadata only; safe for client forms. Fixed SMTP hosts, no user-supplied network destinations. */
export const providerCatalog = {
  brevo: { label: 'Brevo', mode: 'api', daily: 300, monthly: 9300, registration: 'https://app.brevo.com', credentials: 'https://app.brevo.com/settings/keys/api', sender: 'https://app.brevo.com/senders/list', primaryLabel: 'Clave API', secondaryLabel: '' },
  resend: { label: 'Resend', mode: 'api', daily: 100, monthly: 3000, registration: 'https://resend.com/signup', credentials: 'https://resend.com/api-keys', sender: 'https://resend.com/domains', primaryLabel: 'Clave API', secondaryLabel: '' },
  mailjet: { label: 'Mailjet', mode: 'smtp', host: 'in-v3.mailjet.com', daily: 200, monthly: 6000, registration: 'https://app.mailjet.com/signup', credentials: 'https://app.mailjet.com/account/setup', sender: 'https://app.mailjet.com/account/sender', primaryLabel: 'API Key', secondaryLabel: 'Secret Key' },
  smtp2go: { label: 'SMTP2GO', mode: 'smtp', host: 'mail.smtp2go.com', daily: 200, monthly: 1000, registration: 'https://www.smtp2go.com/pricing/', credentials: 'https://app.smtp2go.com/', sender: 'https://app.smtp2go.com/', primaryLabel: 'Usuario SMTP', secondaryLabel: 'Contraseña SMTP' },
  mailersend: { label: 'MailerSend', mode: 'smtp', host: 'smtp.mailersend.net', daily: 100, monthly: 500, registration: 'https://accounts.mailersend.com/signup', credentials: 'https://www.mailersend.com/help/smtp-relay', sender: 'https://app.mailersend.com/', primaryLabel: 'Usuario SMTP', secondaryLabel: 'Contraseña SMTP' },
} as const;
export type ProviderId = keyof typeof providerCatalog;
export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(providerCatalog, value);
}
export const providerIds = Object.keys(providerCatalog) as ProviderId[];
