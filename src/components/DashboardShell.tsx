'use client';

import React, { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { Navbar } from './Navbar';
import { MobileBottomNav } from './MobileBottomNav';
import { PresenceContext } from '@/contexts/PresenceContext';
import { usePresence } from '@/hooks/usePresence';
import type { UserRole } from '@/lib/types';

interface RankingData {
  position: number;
  totalInterpreters: number;
  myMinutes: number;
  avgMinutes: number;
}

interface DashboardShellProps {
  children: React.ReactNode;
  role: UserRole;
  userName: string;
  interpreterId?: number | null;
  userEmail?: string;
  notifications?: unknown[];
  ranking?: RankingData | null;
}

export function DashboardShell({ children, role, userName, interpreterId, userEmail = '', notifications = [], ranking = null }: DashboardShellProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const presenceState = usePresence({
    interpreterId: role === 'interpreter' ? (interpreterId ?? null) : null,
    userEmail,
  });

  // Load preference from localStorage on mount
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('sidebar-collapsed');
      if (saved !== null) setIsCollapsed(saved === 'true');
    } catch {
      // Private browsing or storage policies must not block the dashboard.
    }
  }, []);

  const handleToggle = () => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    try {
      window.localStorage.setItem('sidebar-collapsed', String(newState));
    } catch {
      // Keep the toggle working even without persistent storage.
    }
  };

  return (
    <PresenceContext.Provider value={presenceState}>
      <div className="flex min-h-dvh w-full theme-workspace bg-[var(--background)] text-[var(--foreground)] overflow-hidden">
        <Sidebar
          role={role}
          isCollapsed={isCollapsed}
          onToggle={handleToggle}
          ranking={ranking}
        />

        <div className="flex min-w-0 flex-col flex-1 h-dvh overflow-hidden">
          <Navbar email={userName} notifications={notifications} role={role} />

          <main className="min-h-0 flex-1 p-4 md:p-8 overflow-y-auto custom-scrollbar transition-all duration-500 relative">
            <div className="max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-700 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-20">
              {children}
            </div>
          </main>
        </div>

        {/* Mobile Bottom Navigation */}
        <MobileBottomNav role={role} />
      </div>
    </PresenceContext.Provider>
  );
}
