import React from 'react';
import { cn } from '@/lib/utils';

interface RoleBadgeProps {
  role: string | null;
}

export function RoleBadge({ role }: RoleBadgeProps) {
  const styles: Record<string, string> = {
    admin: "bg-red-500/10 text-red-400 border-red-500/20",
    interpreter: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    candidate: "bg-amber-500/10 text-amber-300 border-amber-500/20",
    recruiter: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    manager: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  };

  return (
    <span className={cn(
      "px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all hover:scale-105 cursor-default shadow-lg shadow-black/20",
      styles[role ?? ''] || "bg-slate-500/10 text-slate-400 border-slate-500/20"
    )}>
      {role || 'Sin rol'}
    </span>
  );
}
