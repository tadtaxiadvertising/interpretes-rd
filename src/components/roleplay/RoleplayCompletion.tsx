'use client';

import React from 'react';
import { CheckCircle2, ChevronRight, Loader2, Send, FileText, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RoleplayCompletionProps {
  sessionId: string;
  scenariosCompleted: number;
  totalDuration: number;
  onSubmit: () => void;
  onBack: () => void;
  isSubmitting?: boolean;
  isComplete?: boolean;
}

export function RoleplayCompletion({ 
  sessionId, 
  scenariosCompleted, 
  totalDuration, 
  onSubmit, 
  onBack,
  isSubmitting,
  isComplete
}: RoleplayCompletionProps) {
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  if (isComplete) {
    return (
      <div className="min-h-screen bg-slate-950 py-12 px-4 flex items-center justify-center">
        <div className="glass p-12 rounded-3xl border border-white/5 text-center max-w-md animate-in fade-in zoom-in-95 duration-700">
          <div className="absolute -top-20 -left-20 w-64 h-64 bg-emerald-500/30 rounded-full blur-[100px] pointer-events-none" />
          <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-blue-500/30 rounded-full blur-[100px] pointer-events-none" />
          
          <div className="relative w-24 h-24 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-6 border border-emerald-500/20">
            <CheckCircle2 size={48} className="text-emerald-400" />
          </div>
          
          <h2 className="text-3xl font-extrabold text-white tracking-tight mb-2">
            ¡Evaluación Enviada!
          </h2>
          <p className="text-slate-400 mb-8">
            Tu roleplay ha sido enviado y está en cola para evaluación por nuestro equipo de QA.
          </p>

          <div className="space-y-3 mb-8 p-6 bg-slate-900/50 rounded-2xl border border-emerald-500/20">
            <div className="flex items-center justify-center gap-3 text-green-400">
              <CheckCircle2 size={20} />
              <span className="font-medium">Envío completado</span>
            </div>
            <div className="flex items-center justify-center gap-3 text-slate-400">
              <Clock size={20} />
              <span>Tiempo total: {formatDuration(totalDuration)}</span>
            </div>
            <div className="flex items-center justify-center gap-3 text-slate-400">
              <FileText size={20} />
              <span>{scenariosCompleted} escenarios evaluados</span>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <button
              onClick={onBack}
              className="w-full py-4 rounded-xl font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors flex items-center justify-center gap-2"
            >
              <CheckCircle2 size={20} />
              Ver Estado en Dashboard
            </button>
          </div>

          <div className="mt-6 pt-6 border-t border-white/5">
            <p className="text-[10px] text-emerald-500 font-black uppercase tracking-[0.2em]">
              Session ID: {sessionId.slice(0, 12)}...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="glass p-8 rounded-3xl border border-white/5">
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-blue-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <FileText size={40} className="text-blue-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Resumen de tu Evaluación</h2>
          <p className="text-slate-400">Revisa tu progreso antes del envío final</p>
        </div>

        <div className="space-y-4 mb-8">
          <div className="grid grid-cols-3 gap-3">
            <div className="p-4 bg-slate-900/50 rounded-xl border border-white/5 text-center">
              <p className="text-xs text-slate-500">Escenarios</p>
              <p className="text-2xl font-bold text-white">{scenariosCompleted} / {scenariosCompleted}</p>
            </div>
            <div className="p-4 bg-slate-900/50 rounded-xl border border-white/5 text-center">
              <p className="text-xs text-slate-500">Tiempo Total</p>
              <p className="text-2xl font-bold text-white">{formatDuration(totalDuration)}</p>
            </div>
            <div className="p-4 bg-slate-900/50 rounded-xl border border-white/5 text-center">
              <p className="text-xs text-slate-500">Estado</p>
              <p className="text-xl font-bold text-green-400">Listo para enviar</p>
            </div>
          </div>
        </div>

        <div className="glass p-4 rounded-xl border border-white/5 bg-slate-900/40 mb-6">
          <h3 className="font-bold text-white mb-3 flex items-center gap-2">
            <Send className="text-blue-400" size={20} />
            ¿Qué pasa después del envío?
          </h3>
          <ul className="text-sm text-slate-300 space-y-2">
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
              Tu evaluación entra en cola de revisión QA
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
              Un evaluador certificado revisará cada escenario
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
              Recibirás notificación con resultados y feedback
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
              Tu autoevaluación se comparará con la evaluación QA
            </li>
          </ul>
        </div>

        <div className="flex gap-4">
          <button
            onClick={onBack}
            className="flex-1 py-4 rounded-xl font-bold border border-white/10 text-gray-300 hover:bg-white/5 transition-colors flex items-center justify-center gap-2"
          >
            <ChevronRight size={18} className="rotate-180" />
            Revisar Respuestas
          </button>
          <button
            onClick={onSubmit}
            disabled={isSubmitting}
            className={cn(
              "flex-1 py-4 rounded-xl font-bold transition-all flex items-center justify-center gap-2",
              isSubmitting
                ? "bg-slate-800 text-slate-500 cursor-not-allowed opacity-50"
                : "bg-emerald-600 text-white shadow-xl shadow-emerald-600/30 hover:scale-[1.02] active:scale-95"
            )}
          >
            {isSubmitting ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                Enviando para Evaluación...
              </>
            ) : (
              <>
                <Send size={20} />
                Enviar para Evaluación QA
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}