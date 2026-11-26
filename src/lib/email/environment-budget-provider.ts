import { providerCatalog, providerIds, type ProviderId } from './provider-catalog';

/** Budget attribution only. Never rewrites a transport destination or credentials. */
export function environmentBudgetProvider(transport: unknown, smtpHost?: unknown): ProviderId | null {
  if (transport === 'brevo' || transport === 'resend') return transport;
  if (transport !== 'smtp' || typeof smtpHost !== 'string') return null;
  const host = smtpHost.trim().toLowerCase();
  for (const id of providerIds) {
    const entry = providerCatalog[id];
    if (entry.mode === 'smtp' && entry.host === host) return id;
  }
  return null;
}
