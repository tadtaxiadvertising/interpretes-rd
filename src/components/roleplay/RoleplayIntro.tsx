'use client';

import React from 'react';
import { CheckCircle2, Headphones, Mic2, ShieldCheck, AlertCircle, Loader2, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RoleplayIntroProps {
  sessionId: string;
  baseAudioUrl: string;
  scenarioCount: number;
  onStart: () => void;
  onBack: () => void;
  isLoading?: boolean;
}

export function RoleplayIntro({ 
  sessionId, 
  baseAudioUrl, 
  scenarioCount, 
  onStart, 
  onBack,
  isLoading 
}: RoleplayIntroProps) {
  const [equipmentChecks, setEquipmentChecks] = React.useState({
    microphone: false,
    headphones: false,
    audioPlayback: false,
  });
  const [currentCheck, setCurrentCheck] = React.useState<keyof typeof equipmentChecks | null>(null);
  const baseAudioRef = React.useRef<HTMLAudioElement>(null);

  const runEquipmentCheck = async (check: keyof typeof equipmentChecks) => {
    setCurrentCheck(check);
    
    if (check === 'microphone') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
        setEquipmentChecks(prev => ({ ...prev, microphone: true }));
        setTimeout(() => runEquipmentCheck('headphones'), 500);
      } catch {
        setEquipmentChecks(prev => ({ ...prev, microphone: false }));
        setCurrentCheck(null);
      }
    } else if (check === 'headphones') {
      // Check if audio output is available (approximate)
      setEquipmentChecks(prev => ({ ...prev, headphones: true }));
      setTimeout(() => runEquipmentCheck('audioPlayback'), 500);
    } else if (check === 'audioPlayback') {
      if (baseAudioRef.current) {
        try {
          await baseAudioRef.current.play();
          baseAudioRef.current.pause();
          baseAudioRef.current.currentTime = 0;
          setEquipmentChecks(prev => ({ ...prev, audioPlayback: true }));
        } catch {
          setEquipmentChecks(prev => ({ ...prev, audioPlayback: false }));
        }
      }
      setCurrentCheck(null);
    }
  };

  // Do not request microphone permission on mount: browsers require a user
  // gesture and may reject the request before the candidate can interact.
  // Recorder requests microphone access when recording actually begins.

  const steps = [
    { id: 'microphone', label: 'Micrófono', icon: Mic2, description: 'Permite acceso al micrófono para grabar tus respuestas' },
    { id: 'headphones', label: 'Auriculares', icon: Headphones, description: 'Usa auriculares para mejor calidad y evitar eco' },
    { id: 'audioPlayback', label: 'Reproducción', icon: ShieldCheck, description: 'Verifica que puedes escuchar el audio base claramente' },
  ];

  return (
    <div className="min-h-screen bg-slate-950 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="glass p-8 rounded-3xl border border-white/5">
          <div className="text-center mb-8">
            <div className="w-20 h-20 bg-blue-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Mic2 size={40} className="text-blue-400" />
            </div>
            <h1 className="text-3xl font-bold text-white mb-2">Evaluación de Roleplay</h1>
            <p className="text-gray-400">Sesión ID: <code className="font-mono text-xs bg-white/5 px-2 py-1 rounded">{sessionId.slice(0, 12)}...</code></p>
          </div>

          <div className="space-y-6 mb-8">
            <div className="glass p-6 rounded-2xl border border-white/5 bg-slate-900/40">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <ShieldCheck className="text-blue-400" />
                Cómo funciona
              </h3>
              <div className="space-y-3 text-sm text-slate-300">
                <p>• Escucharás <strong>{scenarioCount} escenarios</strong> de audio base</p>
                <p>• Después de cada uno, <strong>grabarás tu interpretación</strong></p>
                <p>• Podrás <strong>revisar y regrabar</strong> antes de continuar</p>
                <p>• Al final, harás una <strong>autoevaluación breve</strong> por escenario</p>
                <p>• Tu envío será evaluado por nuestro equipo de QA</p>
              </div>
            </div>

            <div className="glass p-6 rounded-2xl border border-white/5 bg-slate-900/40">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <AlertCircle className="text-amber-400" />
                Requisitos importantes
              </h3>
              <div className="space-y-3 text-sm text-slate-300">
                <p>• <strong>Entorno silencioso</strong> sin ruido de fondo</p>
                <p>• <strong>Conexión estable</strong> a internet</p>
                <p>• <strong>No recargar la página</strong> durante la grabación</p>
                <p>• <strong>Tiempo límite:</strong> 5 minutos por respuesta</p>
                <p>• Puedes <strong>salir y volver</strong> - tu progreso se guarda</p>
              </div>
            </div>
          </div>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-4">Verificación de equipo</h3>
            <div className="space-y-3">
              {steps.map((step, index) => {
                const isPassed = equipmentChecks[step.id as keyof typeof equipmentChecks];
                const isChecking = currentCheck === step.id;
                
                return (
                  <div 
                    key={step.id}
                    className={cn(
                      "flex items-center gap-4 p-4 rounded-2xl transition-all",
                      isPassed ? "bg-emerald-500/10 border border-emerald-500/20" : 
                      isChecking ? "bg-blue-500/10 border border-blue-500/20 animate-pulse" :
                      "bg-slate-800/40 border border-white/5"
                    )}
                  >
                    <div className={cn(
                      "w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0",
                      isPassed ? "bg-emerald-500/20 text-emerald-400" :
                      isChecking ? "bg-blue-500/20 text-blue-400" :
                      "bg-slate-700 text-slate-500"
                    )}>
                      {isPassed ? (
                        <CheckCircle2 size={24} />
                      ) : isChecking ? (
                        <Loader2 size={24} className="animate-spin" />
                      ) : (
                        <step.icon size={24} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={cn("font-medium", isPassed ? "text-emerald-400" : "text-white")}>
                          {step.label}
                        </span>
                        {isChecking && <span className="text-xs text-blue-400">Verificando...</span>}
                        {isPassed && <span className="text-xs text-emerald-400">✓ Listo</span>}
                      </div>
                      <p className="text-xs text-slate-400 mt-1">{step.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <audio ref={baseAudioRef} src={baseAudioUrl} preload="metadata" />

          <p className="text-xs text-slate-400 mb-4">La comprobación del micrófono se realizará al comenzar la grabación. Si el navegador solicita permiso, selecciona «Permitir».</p>

          <div className="flex gap-4 pt-4 border-t border-white/5">
            <button
              onClick={onBack}
              className="flex-1 py-4 rounded-xl font-bold border border-white/10 text-gray-300 hover:bg-white/5 transition-colors flex items-center justify-center gap-2"
            >
              <ChevronRight size={20} className="rotate-180" />
              Volver
            </button>
            <button
              onClick={onStart}
              disabled={!!isLoading}
              className={cn(
                "flex-1 py-4 rounded-xl font-bold transition-all flex items-center justify-center gap-2",
                !isLoading
                  ? "bg-blue-600 text-white shadow-xl shadow-blue-600/30 hover:scale-[1.02] active:scale-95"
                  : "bg-slate-800 text-slate-500 cursor-not-allowed"
              )}
            >
              {isLoading ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  Iniciando...
                </>
              ) : (
                <>
                  <ChevronRight size={20} />
                  Comenzar Evaluación
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}