'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface RoleplayProgressProps {
  currentStep: number;
  totalSteps: number;
  currentScenario: number;
  totalScenarios: number;
  stepLabels: string[];
  completedScenarios: number[];
}

export function RoleplayProgress({ 
  currentStep, 
  totalSteps, 
  currentScenario, 
  totalScenarios,
  stepLabels,
  completedScenarios
}: RoleplayProgressProps) {
  // Intro is step 0, and the final step has index totalSteps - 1.
  // The previous formula showed only 80% on the completed fifth step.
  const overallProgress = Math.round(
    Math.min(100, Math.max(0, (currentStep / Math.max(1, totalSteps - 1)) * 100))
  );

  return (
    <>
      <div className="w-[116px] rounded-xl border border-[var(--border)] bg-[var(--theme-panel)] px-2 py-2 text-right shadow-sm md:hidden" aria-label="Progreso del Roleplay">
        <p className="text-[11px] font-semibold text-[var(--foreground)]">Escenario {currentScenario + 1}/{totalScenarios}</p>
        <p className="text-[10px] text-[var(--text-secondary)]">{overallProgress}% completado</p>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--theme-hover)]">
          <div className="h-full rounded-full bg-[#1764bf] transition-all" style={{ width: `${overallProgress}%` }} />
        </div>
      </div>
    <div className="hidden space-y-4 md:block">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-white">Progreso General</span>
          <span className="bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full text-xs font-bold">
            {overallProgress}%
          </span>
        </div>
        <span className="text-sm text-slate-400">
          Escenario {currentScenario + 1} de {totalScenarios}
        </span>
      </div>
      
      <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full relative transition-all duration-700"
          style={{ width: `${overallProgress}%` }}
        >
          <div className="absolute inset-0 bg-white/20 animate-pulse" />
        </div>
      </div>

      <div className="flex items-center gap-2">
        {stepLabels.map((label, index) => (
          <React.Fragment key={label}>
            <div className={cn(
              "flex flex-col items-center gap-1 flex-1",
              index < currentStep && "text-emerald-400",
              index === currentStep && "text-blue-400",
              index > currentStep && "text-slate-500"
            )}>
              <div className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center transition-all",
                index < currentStep && "bg-emerald-500 text-white",
                index === currentStep && "bg-blue-600 text-white shadow-lg shadow-blue-600/30",
                index > currentStep && "bg-slate-800 text-slate-500"
              )}>
                {completedScenarios.includes(index) ? (
                  <span className="text-xs font-bold">✓</span>
                ) : (
                  <span className="text-sm font-bold">{index + 1}</span>
                )}
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
            </div>
            {index < stepLabels.length - 1 && (
              <div className={cn(
                "flex-1 h-0.5 rounded-full",
                index < currentStep ? "bg-emerald-500/40" : "bg-slate-800"
              )} />
            )}
          </React.Fragment>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 pt-2">
        <div className="p-3 bg-slate-800/40 rounded-xl">
          <p className="text-xs text-slate-500">Escenarios completados</p>
          <p className="text-2xl font-bold text-white">{completedScenarios.length} / {totalScenarios}</p>
        </div>
        <div className="p-3 bg-slate-800/40 rounded-xl">
          <p className="text-xs text-slate-500">Paso actual</p>
          <p className="text-2xl font-bold text-blue-400">{stepLabels[currentStep]}</p>
        </div>
      </div>
    </div>
    </>
  );
}
