import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

const m = vi.hoisted(() => ({ profile: vi.fn(), actor: vi.fn(), load: vi.fn(), count: vi.fn(), scope: vi.fn(), shell: vi.fn(), redirect: vi.fn((path: string) => { throw new Error('redirect:' + path); }) }));
vi.mock('@/app/actions/auth', () => ({ getCurrentProfile: m.profile }));
vi.mock('@/lib/auth/current-actor', () => ({ getCurrentActor: m.actor }));
vi.mock('@/lib/notifications/load-navbar-unread-count', () => ({ loadNavbarUnreadCount: m.count }));
vi.mock('@/lib/notifications/load-navbar-notifications', () => ({ loadNavbarNotifications: m.load }));
vi.mock('@/lib/notifications/notification-preference-scope', () => ({ notificationPreferenceScope: m.scope }));
vi.mock('next/navigation', () => ({ redirect: m.redirect }));
vi.mock('@/components/DashboardShell', () => ({ DashboardShell: (props: { children: React.ReactNode }) => { m.shell(props); return <>{props.children}</>; } }));
import SettingsLayout from './layout';
import AdminLayout from '../admin/layout';
import RecruitmentLayout from '../recruitment/layout';
import QALayout from '../qa/layout';
import InterpretersLayout from '../interpreters/layout';
import ProductionLayout from '../production/layout';
import PayrollLayout from '../payroll/layout';
const layouts = [SettingsLayout, AdminLayout, RecruitmentLayout, QALayout, InterpretersLayout, ProductionLayout, PayrollLayout];

const userId = '123e4567-e89b-42d3-a456-426614174000';
const profileId = '123e4567-e89b-42d3-a456-426614174001';
beforeEach(() => {
  vi.clearAllMocks();
  m.profile.mockResolvedValue({ id: profileId, role: 'admin', display_name: 'Admin' });
  m.actor.mockResolvedValue({ userId, profileId, role: 'admin' });
  m.load.mockResolvedValue([{ id: 'notice-1' }]);
  m.count.mockResolvedValue(24);
  m.scope.mockReturnValue('account-scope');
});
afterEach(cleanup);

describe('settings notification identity', () => {
  it.each(layouts)('loads the same authorized recipient IDs and preference scope in %s', async Layout => {
    render(await Layout({ children: <p>Configuración</p> }));
    expect(screen.getByText('Configuración')).toBeTruthy();
    expect(m.load).toHaveBeenCalledExactlyOnceWith([userId, profileId]);
    expect(m.count).toHaveBeenCalledExactlyOnceWith([userId, profileId]);
    expect(m.scope).toHaveBeenCalledExactlyOnceWith(userId, 'admin');
    expect(m.shell).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin', notifications: [{ id: 'notice-1' }], notificationPreferenceScope: 'account-scope', notificationUnreadCount: 24 }));
  });
  it.each(layouts)('does not load notifications for unauthenticated or nonadministrator actors in %s', async Layout => {
    m.actor.mockResolvedValueOnce(null).mockResolvedValueOnce({ userId, profileId, role: 'interpreter' });
    await expect(Layout({ children: null })).rejects.toThrow('redirect:/login');
    await expect(Layout({ children: null })).rejects.toThrow('redirect:/dashboard');
    expect(m.profile).not.toHaveBeenCalled();
    expect(m.load).not.toHaveBeenCalled();
    expect(m.count).not.toHaveBeenCalled();
  });
  it('fails closed if the profile lookup resolves to a different identity', async () => {
    m.profile.mockResolvedValueOnce({ id: userId, role: 'admin' });
    await expect(SettingsLayout({ children: null })).rejects.toThrow('redirect:/login');
    expect(m.load).not.toHaveBeenCalled();
    expect(m.count).not.toHaveBeenCalled();
    expect(m.scope).not.toHaveBeenCalled();
  });
  it('does not use an administrator-looking profile for a candidate actor', async () => {
    m.actor.mockResolvedValueOnce({ userId, profileId, role: 'candidate' });
    await expect(InterpretersLayout({ children: null })).rejects.toThrow('redirect:/dashboard');
    expect(m.profile).not.toHaveBeenCalled();
    expect(m.load).not.toHaveBeenCalled();
    expect(m.count).not.toHaveBeenCalled();
  });
});
