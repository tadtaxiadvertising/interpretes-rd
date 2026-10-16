/**
 * Normalize an untrusted `next`/`callbackUrl` query value into a safe internal
 * path. Returns null for anything that could be used as an open redirect
 * (absolute URLs, protocol-relative `//host`, backslash tricks, control chars).
 */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value) return null;
  const candidate = value.trim();
  if (candidate.length === 0 || candidate.length > 2048) return null;
  if (!candidate.startsWith('/')) return null;
  if (candidate.startsWith('//')) return null;
  if (candidate.includes('\\')) return null;
  if (candidate.includes(':')) return null;
  if (/[\u0000-\u001f\u007f]/.test(candidate)) return null;
  return candidate;
}
