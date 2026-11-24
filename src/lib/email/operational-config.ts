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

type ConfigurationResult =
  | { status: Exclude<OperationalMailConfigStatus, 'configured'> }
  | { status: 'configured'; config: OperationalMailConfig };

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

  const host = env.OPERATIONAL_SMTP_HOST?.trim();
  const port = env.OPERATIONAL_SMTP_PORT?.trim();
  const user = env.OPERATIONAL_SMTP_USER?.trim();
  const password = env.OPERATIONAL_SMTP_PASSWORD;
  const from = env.OPERATIONAL_EMAIL_FROM?.trim();
  const replyTo = env.OPERATIONAL_EMAIL_REPLY_TO?.trim();
  if (!host || !port || !user || !password || !from) return { status: 'incomplete' };
  if (
    !hostname.test(host) || (port !== '465' && port !== '587')
    || hasControl(user) || hasControl(password)
    || !singleAddress.test(from) || from.length > 254
    || (replyTo && (!singleAddress.test(replyTo) || replyTo.length > 254))
  ) return { status: 'invalid' };

  return {
    status: 'configured',
    config: { host, port: port === '465' ? 465 : 587, secure: port === '465',
      requireTLS: port === '587', user, password, from, ...(replyTo ? { replyTo } : {}) },
  };
}

/** Safe projection for admin UI. Configured does not mean verified or delivered. */
export function operationalMailStatus(env: Readonly<Record<string, string | undefined>>): OperationalMailConfigStatus {
  return readOperationalMailConfig(env).status;
}
