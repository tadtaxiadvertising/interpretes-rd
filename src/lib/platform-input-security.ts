import { z } from 'zod';

export const rejectCredentialLikeText = (value: string) =>
  !/(?:password|passwd|pwd|api[_ -]?key|access[_ -]?token|secret|bearer|authorization)\s*[:=]/i.test(value);

export const safeHttpsUrl = z.string().max(2048).refine(raw => {
  // Check raw input before WHATWG URL parsing, which silently removes CR/LF
  // and tab characters and may reinterpret ambiguous non-web URL spellings.
  const value = raw.replace(/^ +| +$/g, '');
  if (!value) return true;
  if (!/^https:\/\//i.test(value) || /[\u0000-\u0020\u007f]/u.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) &&
      !url.username && !url.password && !url.hash &&
      ![...url.searchParams.keys()].some(key => /(?:token|secret|password|passwd|pwd|api.?key|auth|credential)/i.test(key));
  } catch { return false; }
}, 'URL HTTPS sin credenciales ni tokens requerida')
  .transform(value => value.replace(/^ +| +$/g, ''));
