/**
 * Pure server configuration validation. Never serialize credentials to the
 * browser. No SMTP connection or message delivery is performed here.
 */
export type OperationalMailConfigStatus = 'disabled' | 'incomplete' | 'invalid' | 'configured';
export type OperationalMailConfig = Readonly<{
  host: string;
  port: 465 | 587;
  secure: boolean;
  requireTLS: boolean;
  user: string;
  password: string;
  from: string;
  replyTo?: string;
}>;

export type BrevoMailConfig = Readonly<{ apiKey: string; from: string; replyTo?: string }>;
type ConfigurationResult =
  | { status: Exclude<OperationalMailConfigStatus, 'configured'> }
  | { status: 'configured'; provider: 'smtp'; config: OperationalMailConfig }
  | { status: 'configured'; provider: 'brevo'; config: BrevoMailConfig };

const singleAddress = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,63}$/;
const hostname = /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
const hasControl = (value: string) => Array.from(value).some((character) => {
  const code = character.charCodeAt(0);
  return code < 32 || code === 127;
});

export function readOperationalMailConfig(env: Readonly<Record<string, string | undefined>>): ConfigurationResult {
  const enabled = env.OPERATIONAL_EMAIL_ENABLED;
  if (enabled === undefined || enabled === '' || enabled === 'false') return { status: 'disabled' };
  if (enabled !== 'true') return { status: 'invalid' };

  const provider = env.OPERATIONAL_EMAIL_PROVIDER || 'smtp';
  if (provider !== 'smtp' && provider !== 'brevo') return { status: 'invalid' };
  if (provider === 'brevo') {
    const apiKey = env.BREVO_API_KEY;
    const from = env.OPERATIONAL_EMAIL_FROM?.trim();
    const replyTo = env.OPERATIONAL_EMAIL_REPLY_TO?.trim();
    if (!apiKey || !from) return { status: 'incomplete' };
    if (!/^[!-~]{16,512}$/.test(apiKey) || apiKey.startsWith('xsmtpsib-')
      || !singleAddress.test(from) || from.length > 254
      || (replyTo && (!singleAddress.test(replyTo) || replyTo.length > 254))) return { status: 'invalid' };
    return { status: 'configured', provider: 'brevo', config: { apiKey, from, ...(replyTo ? { replyTo } : {}) } };
  }

  const host = env.OPERATIONAL_SMTP_HOST?.trim();
  const port = env.OPERATIONAL_SMTP_PORT?.trim();
  const user = env.OPERATIONAL_SMTP_USER?.trim();
  const password = env.OPERATIONAL_SMTP_PASSWORD;
  const from = env.OPERATIONAL_EMAIL_FROM?.trim();
  const replyTo = env.OPERATIONAL_EMAIL_REPLY_TO?.trim();
  if (!host || !port || !user || !password || !from) return { status: 'incomplete' };
  if (
    !hostname.test(host) || (port !== '465' && port !== '587')
    || user.includes(':') || hasControl(user) || hasControl(password)
    || !singleAddress.test(from) || from.length > 254
    || (replyTo && (!singleAddress.test(replyTo) || replyTo.length > 254))
  ) return { status: 'invalid' };

  return {
    status: 'configured', provider: 'smtp',
    config: { host, port: port === '465' ? 465 : 587, secure: port === '465',
      requireTLS: port === '587', user, password, from, ...(replyTo ? { replyTo } : {}) },
  };
}

/** Safe projection for admin UI. Configured does not mean verified or delivered. */
export function operationalMailStatus(env: Readonly<Record<string, string | undefined>>): OperationalMailConfigStatus {
  return readOperationalMailConfig(env).status;
}

const requiredMailKeys = ['OPERATIONAL_SMTP_HOST', 'OPERATIONAL_SMTP_PORT', 'OPERATIONAL_SMTP_USER', 'OPERATIONAL_SMTP_PASSWORD', 'OPERATIONAL_EMAIL_FROM'] as const;

/** Administrator-only projection; do not expose SMTP login, host or secrets. */
export function operationalMailDiagnostic(env: Readonly<Record<string, string | undefined>>) {
  const result = readOperationalMailConfig(env);
  return {
    status: result.status,
    provider: env.OPERATIONAL_EMAIL_PROVIDER === 'brevo' ? 'brevo' : env.OPERATIONAL_EMAIL_PROVIDER && env.OPERATIONAL_EMAIL_PROVIDER !== 'smtp' ? 'invalid' : 'smtp',
    missing: (env.OPERATIONAL_EMAIL_PROVIDER === 'brevo' ? ['BREVO_API_KEY', 'OPERATIONAL_EMAIL_FROM'] : requiredMailKeys).filter(key => !env[key]?.trim()),
    sender: result.status === 'configured' ? result.config.from : null,
    replyTo: result.status === 'configured' ? result.config.replyTo ?? null : null,
    tls: result.status === 'configured' ? (result.provider === 'brevo' ? 'HTTPS (Brevo)' : result.config.secure ? 'TLS 465' : 'STARTTLS 587') : null,
  };
}
