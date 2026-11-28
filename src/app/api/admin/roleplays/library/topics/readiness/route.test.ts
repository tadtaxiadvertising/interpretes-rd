import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), bearer: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/auth/actions', () => ({ validateAction: mocks.auth }));
vi.mock('@/lib/api-auth', () => ({ actorFromBearer: mocks.bearer }));
vi.mock('@/lib/roleplay-topics-readiness', () => ({ readRoleplayTopicsReadiness: mocks.read }));
const request = (headers: Record<string,string> = {}) => new NextRequest('https://example.test/api/admin/roleplays/library/topics/readiness', { headers });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ user: { userId: 'admin' } });
  mocks.read.mockResolvedValue({ metadataReady: false, featureFlagEnabled: false, activationAuthorized: false });
});
describe('editorial topic readiness endpoint', () => {
  it('checks the server even if categories are disabled, with private caching', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({success:true,data:{metadataReady:false,featureFlagEnabled:false,activationAuthorized:false}});
    expect(mocks.read).toHaveBeenCalledOnce();
  });
  it('denies unauthorized or mismatched bearer callers before database access', async () => {
    mocks.auth.mockResolvedValueOnce({ error: 'secret detail' });
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('secret detail');
    mocks.bearer.mockResolvedValueOnce({role:'admin',userId:'another'});
    expect((await GET(request({Authorization:'Bearer fixture'}))).status).toBe(403);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('does not leak database errors', async () => {
    mocks.read.mockRejectedValueOnce(new Error('private connection information'));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private connection information');
  });
});
