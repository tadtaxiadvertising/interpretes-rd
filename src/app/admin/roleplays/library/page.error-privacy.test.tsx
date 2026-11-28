// @vitest-environment node
import { isValidElement, type ReactNode } from 'react';
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
    const links: Array<{ href: string; prefetch?: boolean }> = [];
    const labels: string[] = [];
    // Inspect the returned JSX tree, not React component types or module
    // objects (which may contain circular references).
    const visit = (node: ReactNode): void => {
      if (typeof node === 'string') { labels.push(node); return; }
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (!isValidElement<{ children?: ReactNode; href?: string; prefetch?: boolean }>(node)) return;
      if (typeof node.props.href === 'string') links.push({ href: node.props.href, prefetch: node.props.prefetch });
      visit(node.props.children);
    };
    visit(page);
    expect(links).toContainEqual({ href: '/admin/roleplays/library/private-template', prefetch: false });
    expect(links).toContainEqual({ href: '/admin/roleplays/new?sourceSessionId=legacy-template', prefetch: false });
    expect(links.some(link => link.href === '/admin/roleplays/new?sourceSessionId=private-template')).toBe(enabled);
    expect(labels.some(label => label.includes('Asignación privada no habilitada'))).toBe(!enabled);
  });

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
