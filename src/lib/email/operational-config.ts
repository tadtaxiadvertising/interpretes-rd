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
export type ResendMailConfig = Readonly<{ apiKey: string; from: string; replyTo?: string }>;
export type MailConfigurationIssue =
  | 'activation' | 'provider' | 'brevo_smtp_key' | 'brevo_mcp_token' | 'brevo_key_format' | 'resend_key_format'
  | 'sender' | 'reply_to' | 'smtp_host' | 'smtp_port' | 'smtp_user' | 'smtp_password';

type ConfigurationResult =
  | { status: 'disabled' | 'incomplete' }
  | { status: 'invalid'; issues: MailConfigurationIssue[] }
  | { status: 'configured'; provider: 'smtp'; config: OperationalMailConfig }
  | { status: 'configured'; provider: 'brevo'; config: BrevoMailConfig }
  | { status: 'configured'; provider: 'resend'; config: ResendMailConfig };

const singleAddress = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,63}$/;
const hostname = /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
const hasControl = (value: string) => Array.from(value).some((character) => {
  const code = character.charCodeAt(0);
  return code < 32 || code === 127;
});

export function readOperationalMailConfig(env: Readonly<Record<string, string | undefined>>): ConfigurationResult {
  const enabled = env.OPERATIONAL_EMAIL_ENABLED;
  if (enabled === undefined || enabled === '' || enabled === 'false') return { status: 'disabled' };
  if (enabled !== 'true') return { status: 'invalid', issues: ['activation'] };

  const provider = env.OPERATIONAL_EMAIL_PROVIDER || 'smtp';
  if (provider !== 'smtp' && provider !== 'brevo' && provider !== 'resend') return { status: 'invalid', issues: ['provider'] };
  if (provider === 'resend') {
    const apiKey = env.RESEND_API_KEY;
    const from = env.OPERATIONAL_EMAIL_FROM?.trim();
    const replyTo = env.OPERATIONAL_EMAIL_REPLY_TO?.trim();
    if (!apiKey?.trim() || !from) return { status: 'incomplete' };
    const issues: MailConfigurationIssue[] = [];
    if (!/^re_[A-Za-z0-9_-]{8,509}$/.test(apiKey)) issues.push('resend_key_format');
    if (!singleAddress.test(from) || from.length > 254) issues.push('sender');
    if (replyTo && (!singleAddress.test(replyTo) || replyTo.length > 254)) issues.push('reply_to');
    if (issues.length) return { status: 'invalid', issues };
    return { status: 'configured', provider: 'resend', config: { apiKey, from, ...(replyTo ? { replyTo } : {}) } };
  }
  if (provider === 'brevo') {
    const apiKey = env.BREVO_API_KEY;
    const from = env.OPERATIONAL_EMAIL_FROM?.trim();
    const replyTo = env.OPERATIONAL_EMAIL_REPLY_TO?.trim();
    if (!apiKey?.trim() || !from) return { status: 'incomplete' };
    const issues: MailConfigurationIssue[] = [];
    if (apiKey.startsWith('xsmtpsib-')) issues.push('brevo_smtp_key');
    else if (apiKey.startsWith('eyJhcGlfa2V5')) issues.push('brevo_mcp_token');
    else if (!/^[!-~]{16,512}$/.test(apiKey) || /["'{}]/.test(apiKey)) issues.push('brevo_key_format');
    if (!singleAddress.test(from) || from.length > 254) issues.push('sender');
    if (replyTo && (!singleAddress.test(replyTo) || replyTo.length > 254)) issues.push('reply_to');
    if (issues.length) return { status: 'invalid', issues };
    return { status: 'configured', provider: 'brevo', config: { apiKey, from, ...(replyTo ? { replyTo } : {}) } };
  }

  const host = env.OPERATIONAL_SMTP_HOST?.trim();
  const port = env.OPERATIONAL_SMTP_PORT?.trim();
  const user = env.OPERATIONAL_SMTP_USER?.trim();
  const password = env.OPERATIONAL_SMTP_PASSWORD;
  const from = env.OPERATIONAL_EMAIL_FROM?.trim();
  const replyTo = env.OPERATIONAL_EMAIL_REPLY_TO?.trim();
  if (!host || !port || !user || !password || !from) return { status: 'incomplete' };
  const issues: MailConfigurationIssue[] = [];
  if (!hostname.test(host)) issues.push('smtp_host');
  if (port !== '465' && port !== '587') issues.push('smtp_port');
  if (user.includes(':') || hasControl(user)) issues.push('smtp_user');
  if (hasControl(password)) issues.push('smtp_password');
  if (!singleAddress.test(from) || from.length > 254) issues.push('sender');
  if (replyTo && (!singleAddress.test(replyTo) || replyTo.length > 254)) issues.push('reply_to');
  if (issues.length) return { status: 'invalid', issues };

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
    issues: result.status === 'invalid' ? result.issues : [],
    provider: env.OPERATIONAL_EMAIL_PROVIDER === 'resend' ? 'resend' : env.OPERATIONAL_EMAIL_PROVIDER === 'brevo' ? 'brevo' : env.OPERATIONAL_EMAIL_PROVIDER && env.OPERATIONAL_EMAIL_PROVIDER !== 'smtp' ? 'invalid' : 'smtp',
    missing: (env.OPERATIONAL_EMAIL_PROVIDER === 'brevo' ? ['BREVO_API_KEY', 'OPERATIONAL_EMAIL_FROM'] : env.OPERATIONAL_EMAIL_PROVIDER === 'resend' ? ['RESEND_API_KEY', 'OPERATIONAL_EMAIL_FROM'] : requiredMailKeys).filter(key => !env[key]?.trim()),
    sender: result.status === 'configured' ? result.config.from : null,
    replyTo: result.status === 'configured' ? result.config.replyTo ?? null : null,
    tls: result.status === 'configured' ? (result.provider === 'brevo' ? 'HTTPS (Brevo)' : result.provider === 'resend' ? 'HTTPS (Resend)' : result.config.secure ? 'TLS 465' : 'STARTTLS 587') : null,
  };
}
