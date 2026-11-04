import { z } from 'zod';

export const rejectCredentialLikeText = (value: string) =>
  !/(?:password|passwd|pwd|api[_ -]?key|access[_ -]?token|secret|bearer|authorization)\s*[:=]/i.test(value);

export const safeHttpsUrl = z.string().refine(value => {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash &&
      ![...url.searchParams.keys()].some(key => /(?:token|secret|password|passwd|pwd|api.?key|auth|credential)/i.test(key));
  } catch { return false; }
}, 'URL HTTPS sin credenciales ni tokens requerida');
