// @vitest-environment node
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  getCurrentProfile: vi.fn(),
  redirect: vi.fn((destination: string): never => { throw new Error('REDIRECT:' + destination); }),
  interpreters: vi.fn(),
  scores: vi.fn(),
  profileLookup: vi.fn(),
}));

vi.mock('@/app/actions/auth', () => ({ getCurrentProfile: m.getCurrentProfile }));
vi.mock('next/navigation', () => ({ redirect: m.redirect }));
vi.mock('@/lib/prisma', () => ({
  default: {
    interpreter: { findMany: m.interpreters },
    qAScore: { findMany: m.scores },
    userProfile: { findUnique: m.profileLookup },
  },
}));
vi.mock('@/components/DashboardShell', () => ({
  DashboardShell: ({ children, role }: { children: React.ReactNode; role: string }) =>
    React.createElement('section', { 'data-role': role }, children),
}));
vi.mock('@/components/QAEngine', () => ({
  QAEngine: () => React.createElement('div', null, 'QA synthetic form'),
}));

import QALayout from './layout';
import QAPage from './page';

const pageArgs = () => ({ params: Promise.resolve({}), searchParams: Promise.resolve({}) });

describe('QA routes: consistent administrative identity authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.getCurrentProfile.mockResolvedValue({ id: 'profile-1', role: 'admin', display_name: 'Admin' });
    m.interpreters.mockResolvedValue([]);
    m.scores.mockResolvedValue([]);
  });

  it('rejects anonymous visitors in the layout before rendering the admin shell', async () => {
    m.getCurrentProfile.mockResolvedValueOnce(null);
    await expect(QALayout({ children: React.createElement('div') }))
      .rejects.toThrow('REDIRECT:/login');
    expect(m.redirect).toHaveBeenCalledWith('/login');
  });

  it('rejects non-admin users in the layout', async () => {
    m.getCurrentProfile.mockResolvedValueOnce({ role: 'interpreter', display_name: 'User' });
    await expect(QALayout({ children: React.createElement('div') }))
      .rejects.toThrow('REDIRECT:/dashboard');
    expect(m.redirect).toHaveBeenCalledWith('/dashboard');
  });

  it('renders the admin shell for a verified profile independently of auth provider', async () => {
    const layout = await QALayout({ children: React.createElement('p', null, 'QA') });
    expect(layout.props.role).toBe('admin');
    expect(layout.props.userName).toBe('Admin');
    expect(m.getCurrentProfile).toHaveBeenCalledOnce();
  });

  it('also protects direct page entry for anonymous visitors without hitting QA records', async () => {
    m.getCurrentProfile.mockResolvedValueOnce(null);
    await expect(QAPage(pageArgs())).rejects.toThrow('REDIRECT:/login');
    expect(m.interpreters).not.toHaveBeenCalled();
    expect(m.scores).not.toHaveBeenCalled();
  });

  it('also protects direct page entry for candidates and interpreters', async () => {
    m.getCurrentProfile.mockResolvedValueOnce({ role: 'candidate' });
    await expect(QAPage(pageArgs())).rejects.toThrow('REDIRECT:/dashboard');
    expect(m.interpreters).not.toHaveBeenCalled();
    expect(m.scores).not.toHaveBeenCalled();
  });

  it('loads QA data only after the canonical admin profile is confirmed', async () => {
    const result = await QAPage(pageArgs());
    expect(result).toBeTruthy();
    expect(m.interpreters).toHaveBeenCalledOnce();
    expect(m.scores).toHaveBeenCalledOnce();
    // The page must not fall back to Auth.js-only profile lookups.
    expect(m.profileLookup).not.toHaveBeenCalled();
  });
});
