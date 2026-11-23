'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { adminMenu, interpreterMenu } from './Sidebar';
import type { UserRole } from '@/lib/types';

interface MobileBottomNavProps {
  role: UserRole | string;
}

type MenuEntry = (typeof adminMenu)[number];

function matchesPath(pathname: string, item: MenuEntry) {
  return pathname === item.href ||
    (!item.exact && pathname.startsWith(item.href + '/'));
}

const ADMIN_PRIMARY = ['/admin', '/interpreters', '/recruitment', '/admin/roleplays'];
const INTERPRETER_PRIMARY = ['/dashboard', '/dashboard/roleplays', '/dashboard/calendar', '/dashboard/earnings'];

export function MobileBottomNav({ role }: MobileBottomNavProps) {
  const pathname = usePathname();
  const [showMore, setShowMore] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const firstMoreLinkRef = useRef<HTMLAnchorElement>(null);
  const isAdmin = role === 'admin';
  const items = isAdmin ? adminMenu : interpreterMenu;
  const primaryPaths = isAdmin ? ADMIN_PRIMARY : INTERPRETER_PRIMARY;
  const primary = primaryPaths
    .map((path) => items.find((item) => item.href === path))
    .filter((item): item is MenuEntry => Boolean(item));
  const secondary = items.filter((item) => !primaryPaths.includes(item.href));

  // The most specific route is the only selected item, including nested admin routes.
  const current = [...items]
    .filter((item) => matchesPath(pathname, item))
    .sort((a, b) => b.href.length - a.href.length)[0];
  const secondaryActive = Boolean(current && secondary.some((item) => item.href === current.href));

  useEffect(() => {
    // Opening a link must not leave the floating menu over the destination.
    setShowMore(false);
  }, [pathname]);

  useEffect(() => {
    if (showMore) firstMoreLinkRef.current?.focus();
  }, [showMore]);

  const closeMore = () => {
    setShowMore(false);
    moreButtonRef.current?.focus();
  };

  useEffect(() => {
    if (!showMore) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowMore(false);
        moreButtonRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [showMore]);

  const sections = Array.from(new Set(secondary.map((item) => item.section || 'Más opciones')));

  return (
    <nav
      aria-label={isAdmin ? 'Navegación administrativa' : 'Navegación principal'}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-[var(--border)] bg-[var(--theme-nav)] text-[var(--foreground)] shadow-[0_-4px_24px_rgba(0,0,0,0.08)] backdrop-blur-md md:hidden pb-[env(safe-area-inset-bottom)]"
    >
      {showMore && (
        <>
          <button
            type="button"
            aria-label="Cerrar menú de navegación"
            className="fixed inset-0 z-0 bg-slate-950/55"
            onClick={closeMore}
          />
          <section
            id="mobile-more-panel"
            aria-label="Más secciones"
            className="absolute bottom-full left-3 right-3 z-10 mb-2 max-h-[70vh] overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--theme-panel)] p-4 shadow-2xl"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-sm font-bold text-[var(--foreground)]">Todas las secciones</h2>
              <button
                type="button"
                aria-label="Cerrar secciones"
                onClick={closeMore}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--theme-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            {sections.map((section) => (
              <div key={section} className="mb-4 last:mb-0">
                <h3 className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">{section}</h3>
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {secondary.filter((item) => (item.section || 'Más opciones') === section).map((item) => {
                    const Icon = item.icon;
                    const active = current?.href === item.href;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        ref={item.href === secondary[0]?.href ? firstMoreLinkRef : undefined}
                        aria-current={active ? 'page' : undefined}
                        onClick={() => setShowMore(false)}
                        className={cn(
                          'flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors',
                          active ? 'bg-blue-500/10 text-[var(--theme-active)]' : 'text-[var(--text-secondary)] hover:bg-[var(--theme-hover)] hover:text-[var(--foreground)]'
                        )}
                      >
                        <Icon size={18} className="shrink-0" aria-hidden="true" />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
        </>
      )}

      <div className="relative z-10 grid h-16 grid-cols-5 items-stretch gap-1 px-2">
        {primary.map((item) => {
          const Icon = item.icon;
          const active = current?.href === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 text-center text-[10px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-600',
                active ? 'bg-blue-500/10 text-[var(--theme-active)]' : 'text-[var(--text-secondary)] hover:bg-[var(--theme-hover)] hover:text-[var(--foreground)]'
              )}
            >
              <Icon size={19} aria-hidden="true" />
              <span className="max-w-full truncate">{item.label}</span>
            </Link>
          );
        })}
        <button
          ref={moreButtonRef}
          type="button"
          aria-label={showMore ? 'Ocultar más secciones' : 'Mostrar más secciones'}
          aria-expanded={showMore}
          aria-controls="mobile-more-panel"
          onClick={() => setShowMore((open) => !open)}
          className={cn(
            'flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[10px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-600',
            showMore || secondaryActive ? 'bg-blue-500/10 text-[var(--theme-active)]' : 'text-[var(--text-secondary)] hover:bg-[var(--theme-hover)] hover:text-[var(--foreground)]'
          )}
        >
          {showMore ? <X size={19} aria-hidden="true" /> : <Menu size={19} aria-hidden="true" />}
          <span>Más</span>
        </button>
      </div>
    </nav>
  );
}
