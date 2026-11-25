'use client';

import React, { useState } from 'react';
import { History, Search, Clock } from 'lucide-react';

interface Call {
  id: number;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  call_cost: number | null;
  tariff_snapshot: number;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

export function CallHistory({ calls }: { calls: Call[] }) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredCalls = calls.filter(call => {
    const dateStr = formatDate(call.started_at).toLowerCase();
    const timeStr = formatTime(call.started_at).toLowerCase();
    return dateStr.includes(searchTerm.toLowerCase()) || timeStr.includes(searchTerm.toLowerCase());
  });

  return (
    <div className="glass rounded-3xl p-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <History size={22} className="text-[var(--theme-purple)]" />
          <h3 className="text-xl font-bold text-[var(--foreground)]">Call History</h3>
        </div>
        
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={16} />
          <input
            type="text"
            placeholder="Search by date (e.g. May 1)..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-[var(--theme-control-bg)] border border-[var(--theme-control-border)] rounded-xl py-2 pl-10 pr-4 text-sm text-[var(--theme-control-text)] focus:outline-none focus:border-[var(--theme-focus)] transition-colors"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        {/* Mobile View (Cards) */}
        <div className="grid grid-cols-1 gap-4 md:hidden">
          {filteredCalls.map((call) => (
            <div key={call.id} className="bg-[var(--theme-panel)] border border-[var(--border)] rounded-2xl p-4 space-y-3">
              <div className="flex justify-between items-start">
                <div className="flex flex-col">
                  <span suppressHydrationWarning className="text-[var(--foreground)] font-semibold text-sm">{formatDate(call.started_at)}</span>
                  <span suppressHydrationWarning className="text-[var(--text-secondary)] text-xs">{formatTime(call.started_at)}</span>
                </div>
                <span className="text-[var(--theme-success)] font-bold tracking-tight bg-emerald-500/10 px-2 py-1 rounded-lg text-sm">
                  RD${call.call_cost ? Number(call.call_cost).toFixed(2) : '0.00'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-4 pt-3 border-t border-[var(--border)]">
                <div>
                  <p className="text-xs text-[var(--text-tertiary)] mb-1">Duration</p>
                  <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[var(--theme-surface-muted)] text-[var(--foreground)] text-xs font-mono">
                    <Clock size={12} className="text-[var(--text-secondary)]" />
                    {call.duration_seconds ? formatDuration(call.duration_seconds) : '—'}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-tertiary)] mb-1">Rate</p>
                  <p className="text-[var(--text-secondary)] text-xs font-medium">RD${(Number(call.tariff_snapshot) * 60).toFixed(2)}/hr</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Desktop View (Table) */}
        <table className="w-full text-left hidden md:table">
          <thead>
            <tr className="text-[var(--text-tertiary)] text-xs uppercase tracking-wider border-b border-[var(--border)]">
              <th className="pb-4 px-2 font-semibold">Date & Time</th>
              <th className="pb-4 px-2 font-semibold text-center">Duration</th>
              <th className="pb-4 px-2 font-semibold text-center">Hourly Rate</th>
              <th className="pb-4 px-2 font-semibold text-right">Earnings</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {filteredCalls.map((call) => (
              <tr key={call.id} className="group hover:bg-[var(--theme-hover)] transition-all duration-300">
                <td className="py-4 px-2">
                  <div className="flex flex-col">
                    <span suppressHydrationWarning className="text-[var(--foreground)] text-sm font-medium">{formatDate(call.started_at)}</span>
                    <span suppressHydrationWarning className="text-[var(--text-tertiary)] text-xs">{formatTime(call.started_at)}</span>
                  </div>
                </td>
                <td className="py-4 px-2 text-center">
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--theme-surface-muted)] text-[var(--foreground)] text-sm font-mono">
                    <Clock size={12} className="text-[var(--text-secondary)]" />
                    {call.duration_seconds ? formatDuration(call.duration_seconds) : '—'}
                  </div>
                </td>
                <td className="py-4 px-2 text-center">
                  <div className="flex flex-col items-center justify-center">
                    <span className="text-[var(--text-secondary)] text-sm font-medium">RD${(Number(call.tariff_snapshot) * 60).toFixed(2)}/hr</span>
                  </div>
                </td>
                <td className="py-4 px-2 text-right">
                  <span className="text-[var(--theme-success)] font-bold text-sm tracking-tight">
                    RD${call.call_cost ? Number(call.call_cost).toFixed(2) : '0.00'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        {filteredCalls.length === 0 && (
          <div className="py-20 text-center">
            <History size={40} className="mx-auto text-[var(--text-tertiary)] mb-4" />
            <p className="text-[var(--text-tertiary)] font-medium">No calls found match your search.</p>
          </div>
        )}
      </div>
    </div>
  );
}
