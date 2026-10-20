'use client';

import React, { useState } from 'react';
import { CheckCircle2, AlertCircle, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SelfAssessmentProps {
  scenarioId: string;
  scenarioTitle: string;
  onComplete: (scores: Record<string, number>, criticalError: boolean, notes: string) => void;
  isLoading?: boolean;
  initialScores?: Record<string, number>;
  initialCriticalError?: boolean;
  initialNotes?: string;
}

// Canonical QA dimensions (see src/lib/roleplay/scoring.ts). The candidate
// self-assesses on the same five dimensions the evaluator grades, so the
// admin evaluation view can render both side by side without key mapping.
const CRITERIA = [
  { 
    id: 'protocol', 
    label: 'Protocolo', 
    description: '¿Seguiste el protocolo y las instrucciones del escenario?',
    icon: '📋'
  },
  { 
    id: 'interpretation', 
    label: 'Interpretación', 
    description: '¿Transmitiste fielmente el mensaje sin omisiones ni adiciones?',
    icon: '🎯'
  },
  { 
    id: 'language', 
    label: 'Idioma', 
    description: '¿Mantuviste precisión gramatical y el vocabulario adecuado?',
    icon: '🌊'
  },
  { 
    id: 'service', 
    label: 'Servicio', 
    description: '¿Mantuviste un tono profesional, empático y neutral?',
    icon: '🤝'
  },
  { 
    id: 'technical', 
    label: 'Técnico', 
    description: '¿Cuidaste el ritmo, la audibilidad y el manejo de la grabación?',
    icon: '🎧'
  },
] as const;

export function SelfAssessment({ 
  scenarioId, 
  scenarioTitle, 
  onComplete, 
  isLoading,
  initialScores = {},
  initialCriticalError = false,
  initialNotes = '',
}: SelfAssessmentProps) {
  const [scores, setScores] = useState<Record<string, number>>(initialScores);
  const [criticalError, setCriticalError] = useState(initialCriticalError);
  const [notes, setNotes] = useState(initialNotes);
  const [showHelp, setShowHelp] = useState<string | null>(null);

  const handleScoreChange = (criterionId: string, value: number) => {
    setScores(prev => ({ ...prev, [criterionId]: value }));
  };

  const isComplete = CRITERIA.every(c => scores[c.id] !== undefined);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="glass p-6 rounded-2xl border border-white/5 bg-slate-900/40">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-white">Autoevaluación</h2>
            <p className="text-slate-400 text-sm mt-1">{scenarioTitle}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">Completado</p>
            <p className="text-lg font-bold text-white">
              {Object.keys(scores).length} / {CRITERIA.length}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {CRITERIA.map((criterion) => {
            const score = scores[criterion.id];
            return (
              <div 
                key={criterion.id}
                className={cn(
                  "p-4 rounded-2xl border transition-all",
                  score !== undefined 
                    ? "bg-emerald-500/10 border-emerald-500/20" 
                    : "bg-slate-800/40 border-white/5 hover:border-white/10"
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3 flex-1">
                    <span className="text-2xl">{criterion.icon}</span>
                    <div>
                      <h4 className="font-bold text-white">{criterion.label}</h4>
                      <p className="text-xs text-slate-400 mt-0.5">{criterion.description}</p>
                      <button
                        onClick={() => setShowHelp(showHelp === criterion.id ? null : criterion.id)}
                        className="mt-1 text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                      >
                        <HelpCircle size={14} />
                        ¿Qué evalúa esto?
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => (
                      <button
                        key={value}
                        onClick={() => handleScoreChange(criterion.id, value)}
                        disabled={isLoading}
                        className={cn(
                          "w-10 h-10 rounded-xl font-bold text-sm transition-all flex items-center justify-center",
                          score === value
                            ? "bg-blue-600 text-white shadow-lg shadow-blue-600/30 scale-105"
                            : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white"
                        )}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>

                {showHelp === criterion.id && (
                  <div className="mt-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-sm text-blue-300 animate-in fade-in">
                        <strong>{criterion.label}:</strong> Evalúa tu capacidad para{' '}
                        {criterion.id === 'protocol' && 'seguir el protocolo, las instrucciones y el flujo establecido para el escenario.'}
                        {criterion.id === 'interpretation' && 'reproducir fielmente la información sin añadir, omitir ni distorsionar nada.'}
                        {criterion.id === 'language' && 'mantener precisión gramatical y el vocabulario adecuado en ambos idiomas.'}
                        {criterion.id === 'service' && 'mantener neutralidad, tono adecuado y registro profesional sin opiniones personales.'}
                        {criterion.id === 'technical' && 'cuidar el ritmo, la audibilidad y el manejo correcto de la grabación.'}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-6 p-4 rounded-2xl border flex items-center gap-4">
          <div className={cn(
            "flex items-center gap-3 p-3 rounded-xl transition-colors cursor-pointer",
            criticalError ? "bg-red-500/10 border-red-500/20" : "bg-slate-800/40 border-white/5 hover:bg-slate-800/60"
          )}>
            <div className={cn(
              "w-6 h-6 rounded border-2 flex items-center justify-center flex-shrink-0",
              criticalError ? "bg-red-500 border-red-500" : "border-white/20"
            )}>
              {criticalError && <CheckCircle2 size={14} className="text-white" />}
            </div>
            <div>
              <p className="font-bold text-white">¿Cometiste algún error crítico?</p>
              <p className="text-xs text-slate-400">
                Números, fechas, medicamentos, instrucciones vitales, datos personales incorrectos
              </p>
            </div>
          </div>
          <button
            onClick={() => setCriticalError(!criticalError)}
            disabled={isLoading}
            className="ml-auto px-4 py-2 rounded-lg font-medium text-sm transition-colors"
          >
            {criticalError ? 'Sí, cometí error crítico' : 'No, sin errores críticos'}
          </button>
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Notas adicionales (opcional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full bg-slate-800/40 border border-white/5 rounded-xl p-4 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-colors resize-none"
            placeholder="¿Algo que quieras anotar sobre esta respuesta? Dificultades, dudas, decisiones tomadas..."
          />
        </div>

        <button
          onClick={() => onComplete(scores, criticalError, notes)}
          disabled={!isComplete || isLoading}
          className={cn(
            "w-full py-4 rounded-xl font-bold transition-all flex items-center justify-center gap-2",
            isComplete && !isLoading
              ? "bg-emerald-600 text-white shadow-xl shadow-emerald-600/30 hover:scale-[1.02] active:scale-95"
              : "bg-slate-800 text-slate-500 cursor-not-allowed"
          )}
        >
          {isLoading ? (
            <>
              <span className="animate-pulse">Guardando...</span>
            </>
          ) : (
            <>
              <CheckCircle2 size={20} />
              Completar Autoevaluación
            </>
          )}
        </button>

        {!isComplete && (
          <p className="text-center text-xs text-slate-500">
            Califica los {CRITERIA.length - Object.keys(scores).length} criterios restantes para continuar
          </p>
        )}
      </div>
    </div>
  );
}