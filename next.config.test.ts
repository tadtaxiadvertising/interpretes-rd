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

  it('keeps the document CSP strict even when the experimental pilot is enabled', async () => {
    vi.stubEnv('NEXT_PUBLIC_LIVE_WHISPER_PILOT_ENABLED', 'true');
    const rules = await config.headers?.();
    expect(rules?.some((rule) => rule.source === '/live')).toBe(false);

    const siteCsp = rules?.find((rule) => rule.source === '/:path*')?.headers
      .find((header) => header.key === 'Content-Security-Policy')?.value;
    expect(siteCsp).toBeDefined();
    expect(siteCsp).not.toContain('huggingface.co');
    expect(siteCsp).not.toContain('us.aws.cdn.hf.co');

    const chunks = rules?.find((rule) => rule.source === '/_next/static/chunks/:path*');
    const workerCsp = chunks?.headers.find((header) => header.key === 'Content-Security-Policy')?.value;
    expect(workerCsp).toContain('https://huggingface.co');
    // Observed in the passing real Chromium / Hugging Face download smoke.
    expect(workerCsp).toContain('https://us.aws.cdn.hf.co');
    expect(workerCsp).not.toContain('https://*.hf.co');
    expect(workerCsp).not.toContain('https://*.cdn.hf.co');
  });

  it('rejects alternative flag values and does not widen CSP unintentionally', async () => {
    for (const flag of ['false', '1', 'TRUE', 'yes']) {
      vi.stubEnv('NEXT_PUBLIC_LIVE_WHISPER_PILOT_ENABLED', flag);
      const rules = await config.headers?.();
      expect(rules?.some((rule) => rule.source === '/live')).toBe(false);
      expect(rules?.some((rule) => rule.source === '/_next/static/chunks/:path*')).toBe(false);
    }
  });
});
