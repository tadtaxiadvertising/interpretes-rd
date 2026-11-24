// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ process: vi.fn() }));
vi.mock('@/lib/email/recruitment-batch-server', () => ({ processRecruitmentEmailBatch: mocks.process }));
import { POST } from './route';

const secret = 'a'.repeat(64);
function request(header?: string) {
  return new Request('https://example.test/api/cron/recruitment-email', { method: 'POST', headers: header ? { Authorization: header } : {} });
}
describe('recruitment email scheduler route', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('OPERATIONAL_EMAIL_SCHEDULER_SECRET', secret);
    vi.stubEnv('OPERATIONAL_EMAIL_SCHEDULER_ENABLED', 'true');
    vi.stubEnv('OPERATIONAL_EMAIL_GENERAL_ENABLED', 'true');
    vi.stubEnv('OPERATIONAL_EMAIL_PILOT_RECIPIENT', '');
    mocks.process.mockResolvedValue({ status: 'completed', examined: 0, accepted: 0, deferred: 0, cancelled: 0, uncertain: 0 });
  });
  afterEach(() => vi.unstubAllEnvs());
  it('rejects missing, malformed and incorrect credentials before processing', async () => {
    for (const header of [undefined, 'Basic '+secret, 'Bearer '+ 'b'.repeat(64), 'Bearer short']) {
      expect((await POST(request(header))).status).toBe(401);
    }
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it('fails closed if server secret is invalid', async () => {
    vi.stubEnv('OPERATIONAL_EMAIL_SCHEDULER_SECRET', 'short');
    expect((await POST(request('Bearer short'))).status).toBe(401);
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it('requires independent scheduler activation', async () => {
    vi.stubEnv('OPERATIONAL_EMAIL_SCHEDULER_ENABLED', 'false');
    expect((await POST(request('Bearer '+secret))).status).toBe(503);
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it('refuses scheduling in pilot mode or without general opt-in', async () => {
    vi.stubEnv('OPERATIONAL_EMAIL_GENERAL_ENABLED', 'false');
    expect((await POST(request('Bearer '+secret))).status).toBe(503);
    vi.stubEnv('OPERATIONAL_EMAIL_PILOT_RECIPIENT', 'test@example.test');
    expect((await POST(request('Bearer '+secret))).status).toBe(503);
    vi.stubEnv('OPERATIONAL_EMAIL_GENERAL_ENABLED', 'true');
    expect((await POST(request('Bearer '+secret))).status).toBe(503);
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it('returns only a bounded batch report and disables caching', async () => {
    const result = await POST(request('Bearer '+secret));
    expect(result.status).toBe(200);
    expect(result.headers.get('Cache-Control')).toContain('no-store');
    expect(await result.json()).toMatchObject({ status: 'completed', examined: 0 });
    expect(mocks.process).toHaveBeenCalledTimes(1);
  });
  it('reports busy or ambiguous outcomes without retrying', async () => {
    mocks.process.mockResolvedValueOnce({ status: 'busy' }).mockResolvedValueOnce({ status: 'review_required' });
    expect((await POST(request('Bearer '+secret))).status).toBe(429);
    expect((await POST(request('Bearer '+secret))).status).toBe(503);
    expect(mocks.process).toHaveBeenCalledTimes(2);
  });
  it('sanitizes unexpected errors', async () => {
    mocks.process.mockRejectedValue(new Error('private provider details'));
    const result = await POST(request('Bearer '+secret));
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ status: 'unavailable' });
  });
});
