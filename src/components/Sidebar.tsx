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
  Building2,
  Key,
  Mic2,
  AudioLines,
  Library,
  FileText,
  CalendarDays,
  SlidersHorizontal
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
  section?: string;
}

export const adminMenu: MenuItem[] = [
  { icon: LayoutDashboard, label: 'Command Center', href: '/admin', exact: true, section: 'Resumen' },
  { icon: Users, label: 'Intérpretes', href: '/interpreters', section: 'Personas' },
  { icon: UserPlus, label: 'Reclutamiento', href: '/recruitment', section: 'Personas' },
  { icon: Mic2, label: 'Roleplays', href: '/admin/roleplays', section: 'Operaciones' },
  { icon: AudioLines, label: 'Audio Studio', href: '/admin/roleplays/studio', section: 'Operaciones' },
  { icon: Library, label: 'Biblioteca roleplays', href: '/admin/roleplays/library', section: 'Operaciones' },
  { icon: Clock, label: 'Producción', href: '/production', section: 'Operaciones' },
  { icon: Users, label: 'Clientes', href: '/admin/clients', section: 'Operaciones' },
  { icon: Building2, label: 'Cuentas operativas', href: '/admin/accounts', section: 'Operaciones' },
  { icon: Briefcase, label: 'Compañías', href: '/admin/companies', section: 'Operaciones' },
  { icon: Users, label: 'Asignaciones', href: '/admin/assignments', section: 'Operaciones' },
  { icon: FileText, label: 'Reportes de compañías', href: '/admin/reports', section: 'Operaciones' },
  { icon: ShieldCheck, label: 'Conciliación', href: '/admin/reconciliation', section: 'Operaciones' },
  { icon: Briefcase, label: 'Plataformas externas', href: '/admin/platforms', section: 'Operaciones' },
  { icon: CalendarDays, label: 'Calendario de metas', href: '/admin/calendar', section: 'Operaciones' },
  { icon: Clock, label: 'Registro manual', href: '/admin/production/manual', section: 'Operaciones' },
  { icon: ShieldCheck, label: 'Control de calidad (QA)', href: '/qa', section: 'Calidad y cumplimiento' },
  { icon: FileText, label: 'Acuerdos legales', href: '/admin/legal-agreements', section: 'Calidad y cumplimiento' },
  { icon: DollarSign, label: 'Nómina y tarifas', href: '/payroll', section: 'Finanzas' },
  { icon: MessageSquare, label: 'Mensajería', href: '/admin/messages', section: 'Comunicación' },
  { icon: SlidersHorizontal, label: 'Configuración del sistema', href: '/settings', section: 'Administración' },
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
      <div className={cn("px-4 py-5 flex items-center border-b border-white/[0.06]", isCollapsed ? "justify-center" : "justify-between")}>
        {!isCollapsed && (
          <div className="animate-in fade-in duration-500">
            <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-blue-600 bg-clip-text text-transparent truncate">
              {appName || 'Interpretes RD'}
            </h1>
            <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-[0.18em] font-semibold">
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

      <nav aria-label={role === 'admin' ? 'Menú administrativo' : 'Menú principal'} className="mt-3 px-3 flex-1 overflow-y-auto custom-scrollbar">
        {role === 'admin' ? (
          (() => {
            const sections = Array.from(new Set(menuItems.map((item) => item.section || 'General')));
            return sections.map((section) => {
              const sectionItems = menuItems.filter((item) => (item.section || 'General') === section);
              return (
                <div key={section} className="mb-5 last:mb-0">
                  {!isCollapsed && (
                    <p className="px-3 mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                      {section}
                    </p>
                  )}
                  <div className="space-y-1">
                    {sectionItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = menuItems.indexOf(item) === activeIndex;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          title={isCollapsed ? item.label : undefined}
                          aria-current={isActive ? 'page' : undefined}
                          className={cn(
                            "flex items-center min-h-11 px-3 rounded-xl transition-all duration-200 group relative",
                            isActive
                              ? "bg-blue-500/15 text-blue-300 ring-1 ring-inset ring-blue-400/20 shadow-[inset_3px_0_0_0_rgba(96,165,250,0.95)]"
                              : "text-slate-400 hover:bg-white/[0.06] hover:text-slate-100",
                            isCollapsed ? "justify-center" : "gap-3"
                          )}
                        >
                          <Icon size={18} strokeWidth={isActive ? 2.3 : 1.8} className="shrink-0" />
                          {!isCollapsed && <span className="text-[13px] font-medium truncate">{item.label}</span>}
                          {!isCollapsed && isActive && <ChevronRight size={15} className="ml-auto shrink-0 text-blue-300" />}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            });
          })()
        ) : (
          <div className="space-y-1">
            {menuItems.map((item, i) => {
              const Icon = item.icon;
              const isActive = i === activeIndex;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={isCollapsed ? item.label : undefined}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    "flex items-center min-h-11 px-3 rounded-xl transition-all duration-200 group relative",
                    isActive ? "bg-blue-600/20 text-blue-300 ring-1 ring-inset ring-blue-400/20" : "text-slate-400 hover:bg-white/[0.06] hover:text-white",
                    isCollapsed ? "justify-center" : "gap-3"
                  )}
                >
                  <Icon size={18} className="shrink-0" />
                  {!isCollapsed && <span className="text-[13px] font-medium truncate">{item.label}</span>}
                  {!isCollapsed && isActive && <ChevronRight size={15} className="ml-auto shrink-0" />}
                </Link>
              );
            })}
          </div>
        )}
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
