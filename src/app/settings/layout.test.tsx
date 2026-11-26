import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

const m = vi.hoisted(() => ({ profile: vi.fn(), auth: vi.fn(), load: vi.fn(), scope: vi.fn(), shell: vi.fn(), redirect: vi.fn((path: string) => { throw new Error('redirect:' + path); }) }));
vi.mock('@/app/actions/auth', () => ({ getCurrentProfile: m.profile }));
vi.mock('@/lib/auth', () => ({ auth: m.auth }));
vi.mock('@/lib/notifications/load-navbar-notifications', () => ({ loadNavbarNotifications: m.load }));
vi.mock('@/lib/notifications/notification-preference-scope', () => ({ notificationPreferenceScope: m.scope }));
vi.mock('next/navigation', () => ({ redirect: m.redirect }));
vi.mock('@/components/DashboardShell', () => ({ DashboardShell: (props: { children: React.ReactNode }) => { m.shell(props); return <>{props.children}</>; } }));
import SettingsLayout from './layout';

const userId = '123e4567-e89b-42d3-a456-426614174000';
const profileId = '123e4567-e89b-42d3-a456-426614174001';
beforeEach(() => {
  vi.clearAllMocks();
  m.profile.mockResolvedValue({ id: profileId, role: 'admin', display_name: 'Admin' });
  m.auth.mockResolvedValue({ userId });
  m.load.mockResolvedValue([{ id: 'notice-1' }]);
  m.scope.mockReturnValue('account-scope');
});
afterEach(cleanup);

describe('settings notification identity', () => {
  it('loads the same authorized recipient IDs and preference scope as admin navigation', async () => {
    render(await SettingsLayout({ children: <p>Configuración</p> }));
    expect(screen.getByText('Configuración')).toBeTruthy();
    expect(m.load).toHaveBeenCalledExactlyOnceWith([userId, profileId]);
    expect(m.scope).toHaveBeenCalledExactlyOnceWith(userId, 'admin');
    expect(m.shell).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin', notifications: [{ id: 'notice-1' }], notificationPreferenceScope: 'account-scope' }));
  });
  it('does not load notifications for unauthenticated or nonadministrator profiles', async () => {
    m.profile.mockResolvedValueOnce(null).mockResolvedValueOnce({ role: 'interpreter', id: profileId });
    await expect(SettingsLayout({ children: null })).rejects.toThrow('redirect:/login');
    await expect(SettingsLayout({ children: null })).rejects.toThrow('redirect:/dashboard');
    expect(m.auth).not.toHaveBeenCalled();
    expect(m.load).not.toHaveBeenCalled();
  });
});
