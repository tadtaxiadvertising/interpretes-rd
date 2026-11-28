// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  default: {
    roleplaySession: { findMany: vi.fn() },
    roleplayLibraryArchive: { findMany: vi.fn() },
  },
}));
vi.mock('./RoleplayLibraryVisibilityButton', () => ({
  RoleplayLibraryVisibilityButton: () => null,
}));

import prisma from '@/lib/prisma';
import RoleplayLibraryPage from './page';

describe('Admin roleplay library protects server error logs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://storage.invalid');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('does not serialize sensitive connection errors or signed storage URLs', async () => {
    const secret = 'FAKE_DB_PASSWORD_IN_ERROR';
    const error = new Error('postgresql://private:' + secret + '@db.invalid');
    error.stack = 'https://storage.invalid/audio?token=FAKE_PRIVATE_SIGNATURE';
    vi.mocked(prisma.roleplaySession.findMany).mockRejectedValueOnce(error);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const page = await RoleplayLibraryPage({ searchParams: Promise.resolve({}) });
    expect(page).toBeTruthy();
    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(
      '[ADMIN ROLEPLAY LIBRARY] Failed to load existing scenario snapshots:', 'Error',
    );
    const serialized = JSON.stringify(log.mock.calls);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('FAKE_PRIVATE_SIGNATURE');
    expect(prisma.roleplayLibraryArchive.findMany).not.toHaveBeenCalled();
  });

  it.each([false, true])('keeps private previews available and gates assignment by configuration (%s)', async enabled => {
    vi.stubEnv('ROLEPLAY_LIBRARY_EDITORIAL_TOPICS_ENABLED', 'false');
    vi.stubEnv('ROLEPLAY_BILINGUAL_OPENING_API_ENABLED', 'true');
    vi.stubEnv('ROLEPLAY_BILINGUAL_OPENING_UI_ENABLED', 'true');
    vi.stubEnv('ROLEPLAY_BILINGUAL_OPENING_ASSIGNMENT_ENABLED', String(enabled));
    const scenario = { id: 'scenario-1', order: 1, title: 'Consulta', durationLimitSec: 120,
      scriptPrompt: null, studioTurn: null, studioSpeaker: null, studioLanguage: null,
      sourceStartSec: null, sourceEndSec: null, expectedKeys: [] };
    const sessions = [
      { id: 'private-template', status: 'INVITED', createdAt: new Date(0), scenarios: [
        { ...scenario, baseAudioUrl: 'private-base/123e4567-e89b-42d3-a456-426614174000/0.mp3' },
      ] },
      { id: 'legacy-template', status: 'INVITED', createdAt: new Date(0), scenarios: [
        { ...scenario, baseAudioUrl: 'https://storage.invalid/storage/v1/object/public/roleplay-audio/base/legacy.mp3' },
      ] },
    ];
    vi.mocked(prisma.roleplaySession.findMany).mockResolvedValueOnce(sessions as unknown as Awaited<ReturnType<typeof prisma.roleplaySession.findMany>>);
    vi.mocked(prisma.roleplayLibraryArchive.findMany).mockResolvedValueOnce([]);
    const page = await RoleplayLibraryPage({ searchParams: Promise.resolve({}) });
    const serialized = JSON.stringify(page);
    expect(serialized).toContain('/admin/roleplays/library/private-template');
    expect(serialized).toContain('/admin/roleplays/new?sourceSessionId=legacy-template');
    expect(serialized.includes('/admin/roleplays/new?sourceSessionId=private-template')).toBe(enabled);
    expect(serialized.includes('Asignación privada no habilitada')).toBe(!enabled);
  it('handles repeated URL query parameters without crashing', async () => {
    vi.mocked(prisma.roleplaySession.findMany).mockResolvedValueOnce([]);
    const page = await RoleplayLibraryPage({ searchParams: Promise.resolve({
      q: ['consulta', 'farmacia'], topic: ['medical', 'finance'], archived: ['1','0'],
    }) });
    expect(page).toBeTruthy();
    expect(prisma.roleplaySession.findMany).toHaveBeenCalledOnce();
  });

  it('also redacts arbitrary non-Error rejection payloads', async () => {
    vi.mocked(prisma.roleplaySession.findMany).mockRejectedValueOnce({
      token: 'FAKE_ARBITRARY_SECRET', message: 'private',
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await RoleplayLibraryPage({ searchParams: Promise.resolve({}) });
    expect(log).toHaveBeenCalledWith(
      '[ADMIN ROLEPLAY LIBRARY] Failed to load existing scenario snapshots:', 'UnknownError',
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('FAKE_ARBITRARY_SECRET');
  });
});
