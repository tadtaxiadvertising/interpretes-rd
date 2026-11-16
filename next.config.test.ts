import { afterEach, describe, expect, it, vi } from 'vitest';
import config from './next.config';

afterEach(() => vi.unstubAllEnvs());

describe('Whisper pilot Content Security Policy', () => {
  it('does not allow model download domains anywhere when the pilot is disabled', async () => {
    vi.stubEnv('NEXT_PUBLIC_LIVE_WHISPER_PILOT_ENABLED', '');
    const rules = await config.headers?.();
    expect(rules).toBeDefined();
    expect(rules?.some((rule) => rule.source === '/live')).toBe(false);
    expect(rules?.some((rule) => rule.source === '/_next/static/chunks/:path*')).toBe(false);
    const csp = rules?.find((rule) => rule.source === '/:path*')?.headers
      .find((header) => header.key === 'Content-Security-Policy')?.value;
    expect(csp).not.toContain('huggingface.co');
  });

  it('enables exact model download locations only when the pilot flag is explicitly true', async () => {
    vi.stubEnv('NEXT_PUBLIC_LIVE_WHISPER_PILOT_ENABLED', 'true');
    const rules = await config.headers?.();
    const live = rules?.find((rule) => rule.source === '/live');
    const chunks = rules?.find((rule) => rule.source === '/_next/static/chunks/:path*');
    expect(live?.headers.some((header) =>
      header.key === 'Content-Security-Policy' && header.value.includes('https://huggingface.co'),
    )).toBe(true);
    expect(chunks?.headers.some((header) =>
      header.key === 'Content-Security-Policy' && header.value.includes('https://huggingface.co'),
    )).toBe(true);
  });
});
