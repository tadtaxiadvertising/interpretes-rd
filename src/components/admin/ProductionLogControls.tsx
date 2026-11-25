"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, SlidersHorizontal, X, CalendarDays, Users } from "lucide-react";
import { useEffect, useMemo, useState, useTransition, useCallback } from "react";

const statusFilters = [
  { value: "all", label: "Todos" },
  { value: "Completed", label: "Completados" },
  { value: "Importado", label: "Importados" },
  { value: "PROCESSED", label: "Procesados" },
  { value: "OK", label: "OK" },
  { value: "Pending", label: "Pendientes" },
  { value: "Inactive", label: "Inactivos" },
];

export function ProductionLogControls() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [showInterpreterDropdown, setShowInterpreterDropdown] = useState(false);
  const filter = searchParams.get("filter") ?? "all";
  const fromDate = searchParams.get("fromDate") ?? "";
  const toDate = searchParams.get("toDate") ?? "";
  const interpreterId = searchParams.get("interpreterId") ?? "all";

  const [interpreters, setInterpreters] = useState<{ id: number; name: string }[]>([]);
  const [interpretersLoading, setInterpretersLoading] = useState(false);

  useEffect(() => {
    setInterpretersLoading(true);
    fetch("/api/v1/interpreters/select")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setInterpreters(data);
      })
      .catch(() => setInterpreters([]))
      .finally(() => setInterpretersLoading(false));
  }, []);

  const baseParams = useMemo(() => new URLSearchParams(searchParams.toString()), [searchParams]);

  const updateUrl = useCallback(
    (params: URLSearchParams) => {
      startTransition(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }));
    },
    [pathname, router, startTransition]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(baseParams.toString());
      if (search.trim()) params.set("search", search.trim());
      else params.delete("search");
      updateUrl(params);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [baseParams, updateUrl, search]);

  function updateFilter(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") params.delete("filter");
    else params.set("filter", value);
    params.delete("page");
    updateUrl(params);
  }

  function updateFromDate(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("fromDate", value);
    else params.delete("fromDate");
    params.delete("page");
    updateUrl(params);
  }

  function updateToDate(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("toDate", value);
    else params.delete("toDate");
    params.delete("page");
    updateUrl(params);
  }

  function updateInterpreter(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") params.delete("interpreterId");
    else params.set("interpreterId", value);
    params.delete("page");
    updateUrl(params);
  }

  function clearAll() {
    setSearch("");
    startTransition(() => router.replace(pathname, { scroll: false }));
  }

  const hasAnyFilter = search || filter !== "all" || fromDate || toDate || interpreterId !== "all";

  return (
    <div className="space-y-4">
      {/* Row 1: Search + Status + Reset */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 w-full flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Buscar registros de producción"
            placeholder="Buscar intérprete, campaña, estado u observaciones..."
            className="w-full rounded-xl border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] py-2.5 pl-10 pr-9 text-sm text-[var(--theme-control-text)] outline-none transition focus:border-[var(--theme-focus)] focus:ring-2 focus:ring-[var(--theme-focus)]"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-[var(--text-tertiary)] hover:bg-[var(--theme-hover)] hover:text-[var(--foreground)]" aria-label="Limpiar búsqueda">
              <X size={16} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <SlidersHorizontal size={18} className="text-[var(--text-tertiary)]" />
          <select aria-label="Estado de producción" value={filter} onChange={(event) => updateFilter(event.target.value)} className="rounded-xl border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] px-3 py-2.5 text-sm text-[var(--theme-control-text)] outline-none focus:border-[var(--theme-focus)]">
            {statusFilters.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          {hasAnyFilter && <button type="button" onClick={clearAll} className="theme-action-secondary rounded-xl px-3 py-2.5 text-sm">Limpiar filtros</button>}
          {isPending && <span role="status" className="text-xs text-[var(--theme-link)]">Actualizando...</span>}
        </div>
      </div>

      {/* Row 2: Date range + Interpreter + Show all interpreters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <CalendarDays size={18} className="text-[var(--text-tertiary)]" />
          <input
            type="date"
            value={fromDate}
            onChange={(event) => updateFromDate(event.target.value)}
            className="rounded-xl border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] px-3 py-2.5 text-sm text-[var(--theme-control-text)] outline-none focus:border-[var(--theme-focus)]"
            aria-label="Desde la fecha"
          />
          <span className="text-[var(--text-tertiary)] text-sm">→</span>
          <input
            type="date"
            value={toDate}
            onChange={(event) => updateToDate(event.target.value)}
            className="rounded-xl border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] px-3 py-2.5 text-sm text-[var(--theme-control-text)] outline-none focus:border-[var(--theme-focus)]"
            aria-label="Hasta la fecha"
          />
        </div>

        <div className="flex min-w-0 items-center gap-2">
          <Users size={18} className="text-[var(--text-tertiary)]" />
          <div className="relative min-w-0 flex-1">
            <button
              type="button"
              aria-expanded={showInterpreterDropdown}
              aria-controls={showInterpreterDropdown ? "production-interpreter-options" : undefined}
              onClick={() => setShowInterpreterDropdown(!showInterpreterDropdown)}
              className={cn(
                "rounded-xl border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--theme-focus)] w-full min-w-0 text-left flex items-center justify-between",
                interpreterId !== "all" ? "text-[var(--theme-link)]" : "text-[var(--theme-control-text)]"
              )}
            >
              <span>
                {interpreterId !== "all"
                  ? `${interpreters.find((i) => String(i.id) === interpreterId)?.name ?? `ID: ${interpreterId}`} — Historial completo`
                  : "Todos los intérpretes (resumen)"}
              </span>
              <span className="text-[var(--text-tertiary)] ml-2">▾</span>
            </button>
            {showInterpreterDropdown && (
              <div id="production-interpreter-options" className="absolute top-full left-0 mt-1 w-full min-w-0 max-h-[300px] overflow-y-auto rounded-xl border border-[var(--theme-control-border)] bg-[var(--theme-panel)] shadow-2xl z-50">
                <button
                  type="button"
                  onClick={() => { updateInterpreter("all"); setShowInterpreterDropdown(false); }}
                  className={cn("w-full text-left px-4 py-2 text-sm hover:bg-[var(--theme-hover)]", interpreterId === "all" ? "text-[var(--theme-link)]" : "text-[var(--theme-control-text)]")}
                >
                  Todos los intérpretes
                </button>
                <div className="border-t border-[var(--border)]" />
                {interpretersLoading ? (
                  <div role="status" className="px-4 py-3 text-sm text-[var(--text-tertiary)]">Cargando intérpretes...</div>
                ) : (
                  interpreters.map((interp) => (
                    <button
                      key={interp.id}
                      type="button"
                      onClick={() => { updateInterpreter(String(interp.id)); setShowInterpreterDropdown(false); }}
                      className={cn("w-full text-left px-4 py-2 text-sm hover:bg-[var(--theme-hover)]", String(interp.id) === interpreterId ? "text-[var(--theme-link)] font-semibold" : "text-[var(--foreground)]")}
                    >
                      {interp.name}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function cn(...classes: (string | boolean | undefined | null)[]) {
  return classes.filter(Boolean).join(" ");
}
