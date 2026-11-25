'use client';

import React, { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, TrendingUp, Clock, Crown, Sparkles, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface GoalProgressWidgetProps {
  monthlyGoal: number;
  q1Minutes: number;
  q2Minutes: number;
  isQ1: boolean;
  tariffPerMinute: number;
}

export function GoalProgressWidget({
  monthlyGoal,
  q1Minutes,
  q2Minutes,
  isQ1,
  tariffPerMinute,
}: GoalProgressWidgetProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  
  const handleRefresh = () => {
    startTransition(() => {
      router.refresh();
    });
  };

  const currentMinutes = isQ1 ? q1Minutes : q1Minutes + q2Minutes;
  
  const superGoal = Math.round(monthlyGoal * 1.6);
  const targetMinutes = isQ1 ? monthlyGoal / 2 : monthlyGoal;
  
  const isGoalMet = currentMinutes >= targetMinutes;
  const isSuperGoalMet = currentMinutes >= superGoal;
  
  const visualMax = isQ1 ? targetMinutes : superGoal;
  const percentage = Math.min(Math.round((currentMinutes / visualMax) * 100), 100);

  const baseRate = Math.round(tariffPerMinute * 60);
  const penalizedRate = Math.max(0, baseRate - 50);

  let statusColorClass = "bg-amber-500/10 text-[var(--theme-warning)] border-amber-500/20";
  let barColorClass = "bg-[var(--theme-warning)]";
  let StatusIcon = AlertTriangle;
  let statusText = "Tarifa Reducida Temporal";
  
  if (isSuperGoalMet && !isQ1) {
    statusColorClass = "bg-yellow-500/10 text-[var(--theme-warning)] border-yellow-500/20";
    barColorClass = "bg-[var(--theme-warning)]";
    StatusIcon = Crown;
    statusText = "¡Súper Meta Asegurada!";
  } else if (isGoalMet) {
    if (!isQ1 && currentMinutes < superGoal) {
      statusColorClass = "bg-indigo-500/10 text-[var(--theme-purple)] border-indigo-500/20";
      barColorClass = "bg-[var(--theme-purple)]";
      StatusIcon = TrendingUp;
      statusText = "Tarifa Completa Asegurada";
    } else {
      statusColorClass = "bg-emerald-500/10 text-[var(--theme-success)] border-emerald-500/20";
      barColorClass = "bg-[var(--theme-success)]";
      StatusIcon = CheckCircle2;
      statusText = "Tarifa Completa Asegurada";
    }
  }

  return (
    <div className={cn(
      "rounded-2xl p-6 border backdrop-blur-sm mt-6 transition-all relative overflow-hidden",
      isSuperGoalMet && !isQ1 
        ? "bg-[var(--theme-panel)] border-yellow-500/30 shadow-[0_0_20px_rgba(234,179,8,0.1)]" 
        : "bg-[var(--theme-panel)] border-[var(--border)]"
    )}>
      {isPending && (
        <div className="absolute inset-0 bg-[var(--theme-panel)] backdrop-blur-[2px] z-10 flex items-center justify-center">
          <RefreshCw className="w-6 h-6 text-[var(--theme-purple)] animate-spin" />
        </div>
      )}
      
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-[var(--foreground)] flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-[var(--theme-purple)]" />
            Progreso de Meta {isQ1 ? 'Quincenal (Q1)' : 'Mensual (Acumulado)'}
          </h3>
          <button 
            onClick={handleRefresh}
            disabled={isPending}
            className="p-1.5 rounded-md hover:bg-[var(--theme-hover)] text-[var(--text-secondary)] hover:text-[var(--foreground)] transition-colors"
            title="Actualizar progreso"
          >
            <RefreshCw className={cn("w-4 h-4", isPending && "animate-spin")} />
          </button>
        </div>
        
        <div className={cn(
          "flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium border",
          statusColorClass
        )}>
          <StatusIcon className="w-4 h-4" />
          {statusText}
        </div>
      </div>

      <div className="mb-4 relative">
        <div className="flex justify-between text-sm font-medium mb-2 text-[var(--text-secondary)]">
          <span className="flex items-center gap-1">
            <Clock className="w-4 h-4 text-[var(--text-secondary)]" />
            {currentMinutes} / {visualMax} min
          </span>
          <span className="text-[var(--foreground)]">{percentage}%</span>
        </div>
        
        <div className="w-full bg-[var(--theme-track)] rounded-full h-3 overflow-hidden relative">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-1000 ease-out relative",
              barColorClass
            )}
            style={{ width: `${percentage}%` }}
          >
          </div>
          
          {!isQ1 && (
            <div 
              className="absolute top-0 bottom-0 w-0.5 bg-[var(--foreground)] z-10" 
              style={{ left: `${(targetMinutes / superGoal) * 100}%` }}
              title="Meta Base"
            />
          )}
        </div>
        
        {!isQ1 && (
          <div className="flex justify-between text-[10px] text-[var(--text-tertiary)] mt-1 px-1 relative h-4">
            <span>0</span>
            <span style={{ position: 'absolute', left: `${(targetMinutes / superGoal) * 100}%`, transform: 'translateX(-50%)' }}>Meta Base</span>
            <span className="absolute right-0 text-[var(--theme-warning)]">Súper Meta</span>
          </div>
        )}
      </div>

      <p className="text-sm text-[var(--text-secondary)] leading-relaxed mt-2">
        {isQ1 ? (
          isGoalMet ? (
            `¡Excelente! Has alcanzado tu meta de la primera quincena. Tu tarifa base está asegurada a $${baseRate}/h.`
          ) : (
            `Alerta: Si no alcanzas los ${targetMinutes} minutos antes del cierre de quincena, tu pago base se calculará a $${penalizedRate}/h. ¡Aún puedes restaurarlo a $${baseRate}/h en la segunda quincena si cumples tu meta mensual!`
          )
        ) : (
          isSuperGoalMet ? (
            <span className="flex items-center gap-2 text-[var(--theme-warning)] font-medium">
              <Sparkles className="w-5 h-5" />
              ¡Súper Meta de 160 horas alcanzada! Un incentivo de +$50 ha sido asegurado para tu nómina de fin de mes.
            </span>
          ) : isGoalMet ? (
            `¡Meta base cumplida! Estás a solo ${superGoal - currentMinutes} minutos de desbloquear tu Súper Meta y ganar un incentivo extra de +$50.`
          ) : (
            `¡Estás a ${targetMinutes - currentMinutes} minutos de cumplir tu meta mensual, recuperar tu tarifa completa de $${baseRate}/h y recibir el reembolso de tu quincena anterior! Bono disponible al llegar a ${Math.round(superGoal / 60)}h.`
          )
        )}
      </p>
    </div>
  );
}
