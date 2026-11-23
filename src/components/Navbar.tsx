'use client';

import React, { useState } from 'react';
import { LogOut, Settings, ShieldCheck } from 'lucide-react';
import { logout } from '@/app/actions/auth';
import { NotificationBell } from './NotificationBell';
import { ThemeSwitcher } from './ThemeSwitcher';
import Image from 'next/image';

interface NavbarProps {
  email?: string;
  notifications?: unknown[];
  onSignOut?: () => void;
}

export function Navbar({ email, notifications = [], onSignOut }: NavbarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const initials = email ? email[0].toUpperCase() : 'U';

  return (
    <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-x-4 border-b border-[var(--border)] bg-[var(--theme-nav)] backdrop-blur-md px-4 shadow-sm sm:gap-x-6 sm:px-6 lg:px-8">
      <div className="flex flex-1 gap-x-4 self-stretch lg:gap-x-6">
        <div className="flex flex-1 items-center gap-2"><Image src="/brand-mark.svg" alt="Intérpretes RD" width={32} height={32} className="md:hidden" /><span className="text-xs font-bold text-[var(--foreground)] md:hidden">Intérpretes RD</span></div>
        <div className="flex items-center gap-x-4 lg:gap-x-6">
          
          <ThemeSwitcher />
          <NotificationBell initialNotifications={notifications as any} />

          {/* Separator */}
          <div className="hidden lg:block lg:h-6 lg:w-px lg:bg-slate-800" aria-hidden="true" />

          {/* User Button (Clerk-like) */}
          <div className="relative">
            <button
              type="button"
              className="flex items-center gap-x-3 p-1 rounded-full hover:bg-slate-800/50 transition-colors focus:outline-none"
              onClick={() => setIsOpen(!isOpen)}
            >
              <div className="h-8 w-8 rounded-full bg-[#002d72] flex items-center justify-center text-white font-semibold text-sm shadow-sm ring-2 ring-transparent hover:ring-blue-500 transition-all">
                {initials}
              </div>
            </button>
            {isOpen && (
              <div className="absolute right-0 z-10 mt-2 w-64 origin-top-right rounded-2xl bg-[var(--theme-panel)] border border-[var(--border)] py-2 shadow-2xl ring-1 ring-white/5 focus:outline-none transition-all">
                <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-indigo-600 flex items-center justify-center text-white font-semibold shadow-sm">
                    {initials}
                  </div>
                  <div className="flex flex-col overflow-hidden">
                    <span className="text-sm font-medium text-[var(--foreground)] truncate">
                      {email ? email.split('@')[0] : 'User Profile'}
                    </span>
                    <span className="text-xs text-[var(--text-secondary)] truncate">
                      {email}
                    </span>
                  </div>
                </div>
                
                <div className="px-2 py-2">
                  <a 
                    href="/dashboard/settings"
                    className="w-full text-left px-3 py-2 rounded-xl text-sm text-slate-300 hover:bg-slate-800 transition-colors flex items-center gap-3"
                  >
                    <Settings size={16} className="text-slate-400" /> Manage Account
                  </a>
                  <a 
                    href="/dashboard/settings"
                    className="w-full text-left px-3 py-2 rounded-xl text-sm text-slate-300 hover:bg-slate-800 transition-colors flex items-center gap-3"
                  >
                    <ShieldCheck size={16} className="text-slate-400" /> Security
                  </a>
                </div>
                
                <div className="px-2 pt-2 border-t border-slate-800">
                  <button 
                    onClick={async () => {
                      if (onSignOut) {
                        onSignOut();
                      } else {
                        await logout();
                      }
                    }}
                    className="w-full text-left px-3 py-2 rounded-xl text-sm text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-3"
                  >
                    <LogOut size={16} /> Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
