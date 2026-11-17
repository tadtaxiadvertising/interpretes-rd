/**
 * Mask sensitive personal identity numbers before rendering them in the UI.
 * This must not depend on punctuation or locale-specific formatting: older
 * records may store Cédula/RNC values with or without separators.
 */
export function maskIdentityDocument(value: string | null | undefined): string {
  if (!value?.trim()) return '—';

  const digits = value.replace(/\D/g, '');
  // Never reveal a short value in full (including malformed legacy records).
  if (digits.length < 4) return '••••';

  return `••••${digits.slice(-2)}`;
}
