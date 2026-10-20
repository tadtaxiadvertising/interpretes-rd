'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  DollarSign,
  ChevronRight,
  ShieldCheck,
  UserPlus,
  Settings,
  Menu,
  ChevronLeft,
  Trophy,
  Award,
  Clock,
  MessageSquare,
  Briefcase,
  Key,
  Mic2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { UserRole } from '@/lib/types';

// ── Menu Definitions ──────────────────────────────────────────────
// Each item has an `href` and an optional `exact` flag.
// When `exact: true`, only `pathname === href` activates the item.
// When `exact: false` (default), `pathname.startsWith(href)` is used
// but ONLY if no other item has a more specific (longer) prefix match.

interface MenuItem {
  icon: React.ElementType;
  label: string;
  href: string;
  exact?: boolean;
}

export const adminMenu: MenuItem[] = [
  { icon: LayoutDashboard, label: 'Command Center', href: '/admin', exact: true },
  { icon: Users, label: 'Interpreter Roster', href: '/interpreters' },
  { icon: UserPlus, label: 'Recruitment', href: '/recruitment' },
  { icon: Mic2, label: 'Roleplays', href: '/admin/roleplays' },
  { icon: Clock, label: 'Production Logs', href: '/production' },
  { icon: Clock, label: 'Calendario de Metas', href: '/admin/calendar' },
  { icon: ShieldCheck, label: 'Quality Assurance', href: '/qa' },
  { icon: DollarSign, label: 'Payroll & Rates', href: '/payroll' },
  { icon: Clock, label: 'Registro Manual', href: '/admin/production/manual' },
  { icon: MessageSquare, label: 'Mensajería', href: '/admin/messages' },
  { icon: Settings, label: 'System Settings', href: '/settings' },
];

export const interpreterMenu: MenuItem[] = [
  { icon: LayoutDashboard, label: 'Mi Dashboard', href: '/dashboard', exact: true },
  { icon: Mic2, label: 'Mis Roleplays', href: '/dashboard/roleplays' },
  { icon: Clock, label: 'Calendario de Metas', href: '/dashboard/calendar' },
  { icon: Trophy, label: 'Mi Ranking', href: '/dashboard/ranking' },
  { icon: DollarSign, label: 'Mis Ganancias', href: '/dashboard/earnings' },
  { icon: MessageSquare, label: 'Mensajería', href: '/dashboard/messages' },
  { icon: Settings, label: 'Configuración', href: '/dashboard/settings' },
];

// ── Ranking data shape ──
interface RankingData {
  position: number;
  totalInterpreters: number;
  myMinutes: number;
  avgMinutes: number;
}

interface SidebarProps {
  role: UserRole | string;
  isCollapsed: boolean;
  onToggle: () => void;
  ranking?: RankingData | null;
  customMenu?: MenuItem[];
  appName?: string;
  appSubtitle?: string;
}

/**
 * Determines the SINGLE active menu item using strict matching:
 *
 * 1. Items with `exact: true` → only `pathname === href`
 * 2. Items without `exact` → `pathname.startsWith(href)`
 * 3. When multiple prefix matches exist, the LONGEST href wins.
 *
 * This guarantees exactly 0 or 1 items are active at any time.
 * NO residual `.active` state — purely derived from `usePathname()`.
 */
function getActiveIndex(pathname: string, items: MenuItem[]): number {
  // Pass 1: Strict exact match (highest priority)
  const exactIdx = items.findIndex(
    (item) => item.exact === true && pathname === item.href
  );
  if (exactIdx !== -1) return exactIdx;

  // Pass 2: Exact match for non-exact items
  const nonExactExact = items.findIndex(
    (item) => item.exact !== true && pathname === item.href
  );
  if (nonExactExact !== -1) return nonExactExact;

  // Pass 3: Longest prefix match among non-exact items only
  let bestIdx = -1;
  let bestLen = 0;
  items.forEach((item, i) => {
    if (item.exact) return; // Skip exact-only items for prefix matching
    if (pathname.startsWith(item.href) && item.href.length > bestLen) {
      bestLen = item.href.length;
      bestIdx = i;
    }
  });

  return bestIdx;
}

export function Sidebar({ role, isCollapsed, onToggle, ranking, customMenu, appName, appSubtitle }: SidebarProps) {
  const pathname = usePathname();
  
  // Determine the correct menu based on role + context
  let defaultMenu = interpreterMenu;
  if (role === 'admin') defaultMenu = adminMenu;
  
  const menuItems = customMenu || defaultMenu;
  const activeIndex = getActiveIndex(pathname, menuItems);

  // Inline ranking data for the sidebar (interpreter only)
  const showRanking = role === 'interpreter' && ranking && !isCollapsed;

  return (
    <aside className={cn(
      "sticky top-0 h-screen glass border-r border-white/10 z-50 hidden md:flex flex-col transition-all duration-500 ease-in-out",
      isCollapsed ? "w-20" : "w-64"
    )}>
      <div className={cn("p-6 flex items-center", isCollapsed ? "justify-center" : "justify-between")}>
        {!isCollapsed && (
          <div className="animate-in fade-in duration-500">
            <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-blue-600 bg-clip-text text-transparent truncate">
              {appName || 'Interpretes RD'}
            </h1>
            <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-widest font-bold">
              {appSubtitle || (role === 'admin' ? 'Admin OS' : 'Portal Intérpretes')}
            </p>
          </div>
        )}
        <button 
          onClick={onToggle}
          className={cn(
            "p-2 hover:bg-white/5 rounded-xl text-slate-400 hover:text-white transition-all",
            isCollapsed && "hover:scale-110"
          )}
        >
          {isCollapsed ? <Menu size={20} /> : <ChevronLeft size={20} />}
        </button>
      </div>

      <nav className="mt-6 px-4 space-y-2 flex-1">
        {menuItems.map((item, i) => {
          const Icon = item.icon;
          // Active state is 100% derived from pathname — zero residual state
          const isActive = i === activeIndex;

          return (
            <Link
              key={item.href}
              href={item.href}
              title={isCollapsed ? item.label : ""}
              className={cn(
                "flex items-center p-3 rounded-xl transition-all duration-300 group relative",
                isActive
                  ? "bg-blue-600/20 text-blue-400 glow"
                  : "text-slate-400 hover:bg-white/5 hover:text-white",
                isCollapsed ? "justify-center" : "justify-between"
              )}
            >
              <div className="flex items-center gap-3">
                <Icon size={20} className={cn("transition-transform group-hover:scale-110", isActive && "text-blue-400")} />
                {!isCollapsed && <span className="font-medium animate-in fade-in duration-300 truncate">{item.label}</span>}
              </div>
              {!isCollapsed && isActive && <ChevronRight size={16} />}
              {isCollapsed && isActive && (
                <div className="absolute left-0 w-1 h-6 bg-blue-500 rounded-r-full shadow-[0_0_10px_rgba(59,130,246,0.5)]" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Mi Ranking mini-card (interpreter sidebar only) */}
      {showRanking && ranking && (
        <div className="px-4 mb-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
          <div className="rounded-2xl bg-gradient-to-br from-amber-500/10 to-transparent border border-amber-500/10 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Award size={16} className="text-amber-400" />
              <span className="text-xs font-bold text-amber-400 uppercase tracking-wide">Mi Ranking</span>
            </div>
            <div className="flex items-baseline gap-1 mb-2">
              <span className="text-2xl font-bold text-white">#{ranking.position}</span>
              <span className="text-xs text-slate-400">de {ranking.totalInterpreters}</span>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Tú</span>
                <span className="text-emerald-400 font-medium">{ranking.myMinutes} min</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Promedio</span>
                <span className="text-slate-300 font-medium">{ranking.avgMinutes} min</span>
              </div>
              {/* Visual bar */}
              <div className="mt-2 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-amber-400 rounded-full"
                  style={{ width: `${Math.round(Math.min((ranking.myMinutes / Math.max(ranking.avgMinutes, 1)) * 50, 100))}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom section — System Status */}
      <div className={cn("p-4 transition-all duration-500", isCollapsed ? "px-2" : "px-4")}>
        <div className={cn(
          "rounded-2xl bg-gradient-to-br from-blue-600/10 to-transparent border border-blue-500/10 transition-all duration-500",
          isCollapsed ? "p-2 flex flex-col items-center" : "p-4"
        )}>
          {!isCollapsed && <p className="text-xs text-slate-500 animate-in fade-in duration-500">System Status</p>}
          <div className={cn("flex items-center gap-2", !isCollapsed && "mt-2")}>
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
            {!isCollapsed && (
              <span className="text-sm font-medium text-slate-300 animate-in fade-in duration-500 truncate">
                Edge API Online
              </span>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
