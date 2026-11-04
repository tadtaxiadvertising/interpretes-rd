import { describe, expect, it } from 'vitest';
import { isPublicApiPath } from './public-api-path';

describe('isPublicApiPath', () => {
  it.each([
    '/api/health',
    '/api/version',
    '/api/roleplay/validate-invite',
    '/api/roleplay/validate-invite-by-code',
    '/api/roleplay/start',
    '/api/auth/session',
    '/api/webhooks/provider',
    '/api/cron/reconcile',
  ])('allows explicitly public route %s', (path) => {
    expect(isPublicApiPath(path)).toBe(true);
  });

  it.each([
    '/api/healthcheck',
    '/api/version/debug',
    '/api/roleplay/start/extra',
    '/api/roleplay/start-legacy',
    '/api/roleplay/validate-invite-extra',
    '/api/roleplay/session/abc',
    '/api/roleplay/session/abc/start',
    '/api/roleplay/convert-audio',
    '/api/auth',
    '/api/webhooks',
    '/api/cron',
    '/api/private',
  ])('keeps non-allowlisted route protected: %s', (path) => {
    expect(isPublicApiPath(path)).toBe(false);
  });
});
