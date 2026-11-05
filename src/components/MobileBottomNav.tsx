'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { adminMenu, interpreterMenu } from './Sidebar';
import type { UserRole } from '@/lib/types';

interface MobileBottomNavProps {
  role: UserRole | string;
}

export function MobileBottomNav({ role }: MobileBottomNavProps) {
  const pathname = usePathname();
  
  // Determine the correct menu based on role
  const menuItems = role === 'admin' ? adminMenu : interpreterMenu;
  const visibleMenuItems = role === 'admin' ? menuItems : menuItems.slice(0, 5);

  return (
    <nav aria-label={role === 'admin' ? 'Navegación administrativa' : 'Navegación principal'} className="fixed bottom-0 left-0 right-0 z-50 bg-[#0a0f1c]/90 backdrop-blur-md border-t border-slate-800 md:hidden pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center h-16 gap-1 px-2 overflow-x-auto">
        {visibleMenuItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.exact 
            ? pathname === item.href 
            : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex shrink-0 flex-col items-center justify-center w-[76px] h-full space-y-1 transition-all duration-300",
                isActive 
                  ? "text-blue-500 scale-110" 
                  : "text-slate-500 hover:text-slate-300"
              )}
            >
              <Icon size={20} className={cn(isActive && "drop-shadow-[0_0_8px_rgba(59,130,246,0.5)]")} />
              <span className="text-[10px] font-medium truncate max-w-[64px] text-center">
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
