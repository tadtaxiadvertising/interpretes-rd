import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchHappyScribeExport,
  isAllowedHappyScribeExportUrl,
} from './happyscribe-download';

afterEach(() => { vi.unstubAllGlobals(); });

describe('HappyScribe SRT download destination safety', () => {
  it('allows provider and AWS HTTPS storage, but not other URLs', () => {
    expect(isAllowedHappyScribeExportUrl(new URL('https://www.happyscribe.com/export/1'))).toBe(true);
    expect(isAllowedHappyScribeExportUrl(new URL('https://s3.us-east-1.amazonaws.com/bucket/file.srt'))).toBe(true);
    expect(isAllowedHappyScribeExportUrl(new URL('https://s3.amazonaws.com/bucket/file.srt'))).toBe(true);
    expect(isAllowedHappyScribeExportUrl(new URL('https://private-bucket.s3.eu-west-1.amazonaws.com/file.srt'))).toBe(true);
    expect(isAllowedHappyScribeExportUrl(new URL('https://private-bucket.s3-eu-west-1.amazonaws.com/file.srt'))).toBe(true);
    expect(isAllowedHappyScribeExportUrl(new URL('https://private-bucket.s3.dualstack.us-east-1.amazonaws.com/file.srt'))).toBe(true);
    expect(isAllowedHappyScribeExportUrl(new URL('https://private-bucket.s3-accelerate.amazonaws.com/file.srt'))).toBe(true);
    // AWS hosts other than S3 are not legitimate HappyScribe object exports.
    expect(isAllowedHappyScribeExportUrl(new URL('https://ec2.us-east-1.amazonaws.com/private'))).toBe(false);
    expect(isAllowedHappyScribeExportUrl(new URL('https://execute-api.us-east-1.amazonaws.com/stage'))).toBe(false);
    expect(isAllowedHappyScribeExportUrl(new URL('https://lambda.us-east-1.amazonaws.com/invoke'))).toBe(false);
    expect(isAllowedHappyScribeExportUrl(new URL('https://s3-website-us-east-1.amazonaws.com/'))).toBe(false);
    expect(isAllowedHappyScribeExportUrl(new URL('https://my-bucket.s3.amazonaws.com.attacker.invalid/file'))).toBe(false);
    expect(isAllowedHappyScribeExportUrl(new URL('http://www.happyscribe.com/export/1'))).toBe(false);
    expect(isAllowedHappyScribeExportUrl(new URL('https://127.0.0.1/data'))).toBe(false);
    expect(isAllowedHappyScribeExportUrl(new URL('https://happyscribe.com.attacker.invalid/data'))).toBe(false);
    expect(isAllowedHappyScribeExportUrl(new URL('https://user:password@www.happyscribe.com/data'))).toBe(false);
    expect(isAllowedHappyScribeExportUrl(new URL('https://www.happyscribe.com:8443/data'))).toBe(false);
  });

  it('rejects a redirect to localhost before contacting the private destination', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response(null, {
      status: 302,
      headers: { Location: 'http://127.0.0.1:5432/private' },
    }));
    vi.stubGlobal('fetch', request);

    await expect(fetchHappyScribeExport(
      'https://www.happyscribe.com/download/file',
      new AbortController().signal,
    )).rejects.toThrow('Untrusted HappyScribe export destination');

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]).toMatchObject({ redirect: 'manual', cache: 'no-store' });
  });

  it('does not follow a redirect from HappyScribe to a non-storage AWS service', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response(null, {
      status: 302,
      headers: { Location: 'https://execute-api.us-east-1.amazonaws.com/private' },
    }));
    vi.stubGlobal('fetch', request);

    await expect(fetchHappyScribeExport(
      'https://www.happyscribe.com/download/file',
      new AbortController().signal,
    )).rejects.toThrow('Untrusted HappyScribe export destination');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('follows a validated HTTPS redirect to AWS storage without exposing credentials', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { Location: 'https://s3.us-east-1.amazonaws.com/export/file.srt?signature=hidden' },
      }))
      .mockResolvedValueOnce(new Response('1\n00:00:00,000 --> 00:00:01,000\nDoctor: Hello'));
    vi.stubGlobal('fetch', request);

    const response = await fetchHappyScribeExport(
      'https://www.happyscribe.com/download/file',
      new AbortController().signal,
    );

    expect(response.ok).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    for (const [, options] of request.mock.calls) {
      expect(options.redirect).toBe('manual');
      expect(options.headers).toBeUndefined();
    }
    expect((request.mock.calls[1][0] as URL).hostname).toBe('s3.us-east-1.amazonaws.com');
  });

  it('limits chained redirects even between approved hosts', async () => {
    const request = vi.fn().mockImplementation(async () => new Response(null, {
      status: 302,
      headers: { Location: '/next' },
    }));
    vi.stubGlobal('fetch', request);

    await expect(fetchHappyScribeExport(
      'https://www.happyscribe.com/download/file',
      new AbortController().signal,
    )).rejects.toThrow('Invalid HappyScribe export redirect');
    expect(request).toHaveBeenCalledTimes(4);
  });
});
