'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { LogOut, Settings } from 'lucide-react';
import { logout } from '@/app/actions/auth';
import { NotificationBell } from './NotificationBell';
import { ThemeSwitcher } from './ThemeSwitcher';
import type { UserRole } from '@/lib/types';

interface NavbarProps {
  email?: string;
  notifications?: unknown[];
  notificationPreferenceScope?: string;
  onSignOut?: () => void;
  role?: UserRole | string;
}

export function Navbar({ email, notifications = [], notificationPreferenceScope, onSignOut, role }: NavbarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const initials = email ? email[0].toUpperCase() : 'U';
  const settingsPath = role === 'admin' ? '/settings' : '/dashboard/settings';
  const homePath = role === 'admin' ? '/admin' : '/dashboard';

  useEffect(() => {
    if (!isOpen) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [isOpen]);

  return (
    <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-x-2 border-b border-[var(--border)] bg-[var(--theme-nav)] px-3 shadow-sm backdrop-blur-md sm:gap-x-4 sm:px-6 lg:px-8">
      <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
        <Link href={homePath} className="flex min-w-0 items-center gap-2 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-focus)] md:hidden" aria-label="Ir al inicio del portal">
          <Image src="/interpretes-rd-logo.webp" alt="" width={32} height={32} className="shrink-0 rounded-lg bg-white p-1" />
          <span className="hidden truncate text-xs font-bold text-[var(--foreground)] sm:inline">Intérpretes RD</span>
        </Link>
        <div className="hidden flex-1 md:block" aria-hidden="true" />
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <ThemeSwitcher />
          <NotificationBell key={notificationPreferenceScope} preferenceScope={notificationPreferenceScope} initialNotifications={notifications as any} />
          <div className="hidden h-6 w-px bg-[var(--border)] lg:block" aria-hidden="true" />

          <div className="relative">
            <button
              type="button"
              aria-label="Menú de usuario"
              aria-expanded={isOpen}
              aria-controls="user-account-menu"
              className="flex items-center gap-2 rounded-full p-1 transition-colors hover:bg-[var(--theme-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-focus)]"
              onClick={() => setIsOpen((open) => !open)}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#002d72] text-sm font-semibold text-white shadow-sm">
                {initials}
              </span>
            </button>
            {isOpen && (
              <>
                <button
                  type="button"
                  aria-label="Cerrar menú de usuario"
                  onClick={() => setIsOpen(false)}
                  className="fixed inset-0 z-0 cursor-default"
                />
                <div id="user-account-menu" className="absolute right-0 z-10 mt-2 w-[min(16rem,calc(100vw-1.5rem))] origin-top-right rounded-2xl border border-[var(--border)] bg-[var(--theme-panel)] py-2 text-[var(--foreground)] shadow-2xl">
                  <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#002d72] font-semibold text-white">{initials}</span>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">{email || 'Mi cuenta'}</span>
                      <span className="truncate text-xs text-[var(--text-secondary)]">{role === 'admin' ? 'Administrador' : 'Intérprete'}</span>
                    </div>
                  </div>
                  <div className="px-2 py-2">
                    <Link
                      href={settingsPath}
                      onClick={() => setIsOpen(false)}
                      className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--theme-hover)] hover:text-[var(--foreground)]"
                    >
                      <Settings size={16} aria-hidden="true" /> Configuración
                    </Link>
                  </div>
                  <div className="border-t border-[var(--border)] px-2 pt-2">
                    <button
                      type="button"
                      onClick={async () => {
                        setIsOpen(false);
                        if (onSignOut) onSignOut();
                        else await logout();
                      }}
                      className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm text-[var(--theme-danger)] transition-colors hover:bg-red-500/10"
                    >
                      <LogOut size={16} aria-hidden="true" /> Cerrar sesión
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
