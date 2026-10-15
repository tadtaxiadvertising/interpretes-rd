'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { FileText, CreditCard, Compass, ChevronRight, ChevronLeft, Check, Loader2, Sparkles, ChevronDown, AlertCircle, ShieldCheck, PartyPopper } from 'lucide-react';
import { cn } from '@/lib/utils';
import { acceptTerms, saveBankingDetails, completeOnboarding } from '@/app/actions/onboarding';
import { BankFormRD, type BankFormData, isBankFormValid } from './BankFormRD';

// ── Freelance Contract content (embedded so it works offline) ──
const LEGAL_CONTENT = `# Contrato de Prestación de Servicios Profesionales (Freelance)

**ENTRE:**

De una parte, **FREE INTERPRETERS**, en adelante denominada "LA AGENCIA".

Y de la otra parte, **[SU NOMBRE]**, en adelante denominado "EL INTÉRPRETE".

**ACUERDAN LO SIGUIENTE:**

### 1. Objeto del Contrato
LA AGENCIA contrata a EL INTÉRPRETE para prestar servicios de interpretación remota (VRI/OPI) de manera independiente y autónoma.

### 2. Naturaleza de la Relación
Las partes reconocen que este es un contrato de servicios profesionales (freelance) y **NO** crea una relación laboral de dependencia, sociedad o asociación. EL INTÉRPRETE actúa como contratista independiente.

### 3. Obligaciones del Intérprete
- Prestar servicios de interpretación con los más altos estándares de calidad, precisión y ética profesional.
- Cumplir con los horarios y turnos acordados previamente.
- Contar con el equipo técnico necesario (computadora, headset, conexión a internet estable y entorno silencioso).
- Mantener la confidencialidad absoluta de toda la información tratada durante las sesiones de interpretación.
- Seguir los Procedimientos Operativos Estándar (SOPs) y políticas de LA AGENCIA.

### 4. Confidencialidad y Protección de Datos
EL INTÉRPRETE se compromete a no divulgar, copiar ni utilizar para fines propios o de terceros ninguna información confidencial de LA AGENCIA o de sus clientes finales (incluyendo información médica, legal o financiera), cumpliendo con las normativas HIPAA y otras leyes aplicables.

### 5. Honorarios y Forma de Pago
- **Tarifa:** Se pagará una tarifa según el esquema de producción acordado.
- **Plataformas:** Los pagos se procesarán según el SOP de Pagos vigente.
- **Frecuencia:** Los pagos se realizarán según la validación de los reportes de producción.

### 6. Vigencia y Terminación
Este contrato tiene una vigencia indefinida a partir de la fecha de firma. Cualquiera de las partes puede terminar este contrato con aviso previo por escrito. LA AGENCIA puede terminar el contrato inmediatamente en caso de incumplimiento grave.

### 7. Penalidades
El incumplimiento de los turnos asignados, problemas recurrentes de calidad o faltas al reglamento interno estarán sujetos a penalidades conforme al "Formato de Penalidades" y "SOP de Penalidades" de LA AGENCIA.

### 8. Ley Aplicable
Este contrato se rige por las leyes vigentes en la República Dominicana.

---

Al continuar, usted acepta todos los términos y condiciones establecidos en este documento.`;

const STEPS = [
  { id: 'legal', label: 'Acuerdo', icon: FileText },
  { id: 'banking', label: 'Pagos', icon: CreditCard },
  { id: 'tutorial', label: 'Tour', icon: Compass },
] as const;

interface OnboardingWizardProps {
  onComplete: () => void;
  interpreterName?: string;
}

export function OnboardingWizard({ onComplete, interpreterName }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  // Step 1 – Legal
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const scrollBoxRef = useRef<HTMLDivElement>(null);

  // Step 2 – Banking
  const [bankData, setBankData] = useState<BankFormData>({
    bankName: '',
    bankAccount: '',
    bankAccountType: '',
    bankCedula: '',
  });

  // Step 3 – Tutorial
  const [tutorialStep, setTutorialStep] = useState(0);

  // ── Scroll detection for legal step ──
  const handleScroll = useCallback(() => {
    const el = scrollBoxRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom) setHasScrolledToBottom(true);
  }, []);

  useEffect(() => {
    const el = scrollBoxRef.current;
    if (currentStep === 0 && el) {
      el.addEventListener('scroll', handleScroll);
      if (el.scrollHeight <= el.clientHeight) setHasScrolledToBottom(true);
      return () => el.removeEventListener('scroll', handleScroll);
    }
  }, [currentStep, handleScroll]);

  // ── Step handlers ──
  async function handleNextLegal() {
    setError(null);
    setIsLoading(true);
    try {
      const result = await acceptTerms();
      if (result.success) {
        setCurrentStep(1);
      } else if (result.code === 'CONFLICT') {
        // Onboarding already completed — skip wizard entirely
        setShowSuccess(true);
        setTimeout(onComplete, 1500);
      } else {
        setError(result.error || 'Error al aceptar términos');
      }
    } catch {
      setError('Error de conexión al servidor');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleNextBanking() {
    setError(null);
    setIsLoading(true);
    try {
      const result = await saveBankingDetails(bankData);
      if (result.success) {
        setCurrentStep(2);
      } else if (result.code === 'CONFLICT') {
        setShowSuccess(true);
        setTimeout(onComplete, 1500);
      } else if (result.code === 'VALIDATION_ERROR') {
        setError('Verifica que los datos bancarios sean correctos');
      } else {
        setError(result.error || 'Error al guardar datos bancarios');
      }
    } catch {
      setError('Error de conexión al servidor');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleFinish() {
    setError(null);
    setIsLoading(true);
    try {
      const result = await completeOnboarding();
      if (result.success) {
        setShowSuccess(true);
        setTimeout(onComplete, 2000);
      } else if (result.code === 'CONFLICT') {
        // Already completed — just close
        setShowSuccess(true);
        setTimeout(onComplete, 1500);
      } else {
        setError(result.error || 'Error al finalizar onboarding');
      }
    } catch {
      setError('Error de conexión al servidor');
    } finally {
      setIsLoading(false);
    }
  }

  const isBankingValid = isBankFormValid(bankData);

  const tutorialHighlights = [
    {
      title: '⏱️ Temporizador de Llamadas',
      description: 'Tu herramienta principal. Presiona "Iniciar Llamada" cuando comiences una interpretación. El tiempo se registra automáticamente, incluso si cambias de pestaña.',
      icon: '⚡'
    },
    {
      title: '📊 Tu Ranking',
      description: 'Compara tu rendimiento con el promedio de la plataforma. Los intérpretes con mejor score obtienen más oportunidades y bonificaciones.',
      icon: '🏆'
    },
    {
      title: '💰 Registro Rápido',
      description: 'Si olvidaste iniciar el temporizador, usa "Registro Rápido" al lado del botón de llamada para registrar minutos manualmente.',
      icon: '💵'
    },
    {
      title: '🎯 Metas Mensuales',
      description: 'Tu meta de minutos se actualiza según tu perfil. Mantente al día para alcanzar el 100% y maximizar tus ganancias.',
      icon: '🎯'
    },
  ];

  const progress = ((currentStep + 1) / STEPS.length) * 100;

  // ── Success overlay ──
  if (showSuccess) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md">
        <div className="relative w-full max-w-md animate-in fade-in zoom-in-95 duration-700">
          <div className="absolute -top-20 -left-20 w-64 h-64 bg-emerald-500/30 rounded-full blur-[100px] pointer-events-none" />
          <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-blue-500/30 rounded-full blur-[100px] pointer-events-none" />
          <div className="relative bg-slate-900 border border-emerald-500/20 rounded-[2.5rem] shadow-2xl p-12 text-center">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-emerald-500/10 text-emerald-400 mb-6 border border-emerald-500/20">
              <PartyPopper size={40} />
            </div>
            <h2 className="text-2xl font-extrabold text-white tracking-tight mb-2">
              ¡Onboarding Completado!
            </h2>
            <p className="text-slate-400 text-sm">
              Tu portal está listo. Accederás al dashboard en breve...
            </p>
            <div className="mt-6 flex items-center justify-center gap-2">
              <Loader2 size={18} className="animate-spin text-emerald-400" />
              <span className="text-emerald-400 font-medium text-sm">Redirigiendo...</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md">
      <div className="relative w-full max-w-2xl animate-in fade-in zoom-in-95 duration-500">
        <div className="absolute -top-20 -left-20 w-64 h-64 bg-blue-500/20 rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-indigo-500/20 rounded-full blur-[100px] pointer-events-none" />

        <div className="relative bg-slate-900 border border-white/10 rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

          <div className="absolute top-0 left-0 w-full h-1 bg-slate-800 z-10">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-700 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="px-10 pt-10 pb-6 border-b border-white/5">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-3xl font-extrabold text-white tracking-tight flex items-center gap-2">
                  ¡Hola{interpreterName ? `, ${interpreterName}` : ''}! <Sparkles className="text-amber-400" size={24} />
                </h2>
                <p className="text-slate-400 mt-1">Configura tu portal en unos segundos.</p>
              </div>
              <div className="bg-blue-500/10 text-blue-400 px-3 py-1 rounded-full text-xs font-bold border border-blue-500/20">
                PASO {currentStep + 1} DE {STEPS.length}
              </div>
            </div>

            <div className="flex items-center gap-3">
              {STEPS.map((step, i) => {
                const Icon = step.icon;
                const isCompleted = i < currentStep;
                const isCurrent = i === currentStep;
                return (
                  <React.Fragment key={step.id}>
                    <div className="flex flex-col items-center gap-2 flex-1">
                      <div className={cn(
                        "w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-500 relative",
                        isCompleted && "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20",
                        isCurrent && "bg-blue-600 text-white shadow-xl shadow-blue-600/30 scale-110",
                        !isCompleted && !isCurrent && "bg-slate-800 text-slate-500"
                      )}>
                        {isCompleted ? <Check size={20} strokeWidth={3} /> : <Icon size={20} />}
                        {isCurrent && (
                          <div className="absolute -inset-1 rounded-2xl border-2 border-blue-500/50 animate-pulse" />
                        )}
                      </div>
                      <span className={cn(
                        "text-[11px] font-bold uppercase tracking-wider transition-colors",
                        isCurrent ? "text-blue-400" : isCompleted ? "text-emerald-400" : "text-slate-500"
                      )}>
                        {step.label}
                      </span>
                    </div>
                    {i < STEPS.length - 1 && (
                      <div className={cn(
                        "flex-1 h-0.5 rounded-full mb-6",
                        isCompleted ? "bg-emerald-500/40" : "bg-slate-800"
                      )} />
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          <div className="px-10 py-8 overflow-y-auto flex-1 custom-scrollbar">
            {currentStep === 0 && (
              <div className="flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="mb-6">
                  <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                    <ShieldCheck size={20} className="text-blue-400" />
                    Acuerdo de Confidencialidad
                  </h3>
                  <p className="text-slate-400 text-sm">
                    Para trabajar con nosotros, es vital que leas y aceptes nuestras políticas de privacidad y manejo de datos.
                  </p>
                </div>

                <div
                  ref={scrollBoxRef}
                  className="bg-slate-950/80 border border-white/5 rounded-3xl p-8 text-slate-300 leading-relaxed text-sm prose prose-invert max-w-none h-[280px] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800"
                >
                  {LEGAL_CONTENT.split('\n').map((line, i) => {
                    if (line.startsWith('# ')) return <h1 key={i} className="text-2xl font-black text-white mb-6">{line.replace('# ', '')}</h1>;
                    if (line.startsWith('### ')) return <h3 key={i} className="text-lg font-bold text-blue-400 mt-8 mb-4">{line.replace('### ', '')}</h3>;
                    if (line.startsWith('**') && line.endsWith('**')) return <p key={i} className="font-bold text-slate-100 my-2">{line.replace(/\*\*/g, '')}</p>;
                    if (line.startsWith('- ')) return <li key={i} className="ml-4 list-disc text-slate-300 my-1">{line.replace('- ', '')}</li>;
                    if (line === '---') return <hr key={i} className="border-white/10 my-8" />;
                    if (line.trim() === '') return <div key={i} className="h-2" />;
                    return <p key={i} className="mb-2">{line}</p>;
                  })}
                </div>

                {!hasScrolledToBottom && (
                  <div className="flex items-center justify-center gap-2 mt-4 text-xs text-blue-400 font-medium animate-bounce">
                    <ChevronDown size={14} />
                    <span>Desliza para leer todo el acuerdo</span>
                  </div>
                )}

                {hasScrolledToBottom && !isLoading && !error && (
                  <div className="mt-4 flex items-center gap-2 py-2 px-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 animate-in fade-in zoom-in duration-500">
                    <Check size={14} />
                    <span className="font-medium">Has leído el documento completo — puedes continuar</span>
                  </div>
                )}

                {error && currentStep === 0 && (
                  <div className="mt-6 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-3 animate-in shake duration-500">
                    <AlertCircle size={20} className="shrink-0" />
                    <p className="font-medium">{error}</p>
                  </div>
                )}
              </div>
            )}

            {currentStep === 1 && (
              <div className="flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="mb-8 text-center">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-500/10 text-blue-400 mb-4 border border-blue-500/20">
                    <CreditCard size={32} />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">¿Cómo te pagamos?</h3>
                  <p className="text-slate-400 text-sm max-w-md mx-auto">
                    Necesitamos tus datos bancarios de República Dominicana para procesar tus pagos de manera segura.
                  </p>
                  <p className="text-slate-500 text-xs max-w-md mx-auto mt-2">
                    Estos datos se almacenan con cifrado y solo se usan para nómina. No podrás modificarlos una vez completado el onboarding — el administrador puede corregirlos si hay errores.
                  </p>
                </div>

                <BankFormRD
                  initialData={bankData}
                  onChange={(data) => setBankData(data)}
                  isLoading={isLoading}
                  standalone={true}
                />

                {error && (
                  <div className="mt-6 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-3 animate-in shake duration-500">
                    <AlertCircle size={20} className="shrink-0" />
                    <p className="font-medium">{error}</p>
                  </div>
                )}
              </div>
            )}

            {currentStep === 2 && (
              <div className="flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="mb-6 text-center">
                  <h3 className="text-xl font-bold text-white mb-2">¡Casi terminamos!</h3>
                  <p className="text-slate-400 text-sm">Explora rápidamente las herramientas que tienes a tu disposición.</p>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  {tutorialHighlights.map((item, i) => (
                    <div
                      key={i}
                      className={cn(
                        "group p-5 rounded-3xl border transition-all duration-300 cursor-pointer flex gap-4 items-start",
                        tutorialStep === i
                          ? "bg-blue-600/10 border-blue-600/40 shadow-xl shadow-blue-950/20"
                          : "bg-slate-800/20 border-white/5 hover:bg-slate-800/40 hover:border-white/10"
                      )}
                      onClick={() => setTutorialStep(i)}
                    >
                      <div className={cn(
                        "w-12 h-12 rounded-2xl flex items-center justify-center text-2xl transition-all duration-500",
                        tutorialStep === i ? "bg-blue-600 scale-110 rotate-3 shadow-lg" : "bg-slate-800 grayscale group-hover:grayscale-0"
                      )}>
                        {item.icon}
                      </div>
                      <div className="flex-1">
                        <h4 className={cn(
                          "text-base font-bold mb-1 transition-colors",
                          tutorialStep === i ? "text-white" : "text-slate-400 group-hover:text-slate-300"
                        )}>
                          {item.title}
                        </h4>
                        {tutorialStep === i && (
                          <p className="text-sm text-slate-300 animate-in fade-in slide-in-from-top-1 duration-300 leading-relaxed">
                            {item.description}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {error && currentStep === 2 && (
                  <div className="mt-6 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-3 animate-in shake duration-500">
                    <AlertCircle size={20} className="shrink-0" />
                    <p className="font-medium">{error}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="px-10 py-6 border-t border-white/5 bg-slate-900/50 backdrop-blur-sm flex items-center justify-between">
            {currentStep > 0 ? (
              <button
                onClick={() => { setCurrentStep(currentStep - 1); setError(null); }}
                className="flex items-center gap-2 px-6 py-3 rounded-2xl text-slate-400 font-bold hover:text-white hover:bg-white/5 transition-all"
              >
                <ChevronLeft size={18} /> Atrás
              </button>
            ) : <div />}

            <div className="flex gap-4">
              {currentStep === 0 && (
                <button
                  onClick={handleNextLegal}
                  disabled={!hasScrolledToBottom || isLoading}
                  className={cn(
                    "group relative flex items-center gap-2 px-8 py-4 rounded-2xl font-bold transition-all duration-500 overflow-hidden",
                    hasScrolledToBottom && !isLoading
                      ? "bg-blue-600 text-white shadow-xl shadow-blue-600/30 hover:scale-[1.02] active:scale-95"
                      : "bg-slate-800 text-slate-500 cursor-not-allowed"
                  )}
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  <span className="relative z-10 flex items-center gap-2">
                    {isLoading ? <Loader2 size={20} className="animate-spin" /> : <>Entendido y Acepto <ChevronRight size={20} /></>}
                  </span>
                </button>
              )}

              {currentStep === 1 && (
                <button
                  onClick={handleNextBanking}
                  disabled={!isBankingValid || isLoading}
                  className={cn(
                    "group relative flex items-center gap-2 px-10 py-4 rounded-2xl font-bold transition-all duration-500 overflow-hidden",
                    isBankingValid && !isLoading
                      ? "bg-blue-600 text-white shadow-xl shadow-blue-600/30 hover:scale-[1.02] active:scale-95"
                      : "bg-slate-800 text-slate-500 cursor-not-allowed"
                  )}
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  <span className="relative z-10 flex items-center gap-2">
                    {isLoading ? <Loader2 size={20} className="animate-spin" /> : <>Confirmar Datos <ChevronRight size={20} /></>}
                  </span>
                </button>
              )}

              {currentStep === 2 && tutorialStep < tutorialHighlights.length - 1 && (
                <button
                  onClick={() => setTutorialStep(prev => prev + 1)}
                  className="group relative flex items-center gap-2 px-8 py-4 rounded-2xl font-bold transition-all duration-500 overflow-hidden bg-blue-600 text-white shadow-xl shadow-blue-600/30 hover:scale-[1.02] active:scale-95"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  <span className="relative z-10 flex items-center gap-2">
                    Siguiente Tip <ChevronRight size={20} />
                  </span>
                </button>
              )}

              {currentStep === 2 && tutorialStep === tutorialHighlights.length - 1 && (
                <button
                  onClick={handleFinish}
                  disabled={isLoading}
                  className="group relative flex items-center gap-3 px-10 py-4 rounded-2xl font-black text-lg transition-all duration-500 overflow-hidden bg-emerald-600 text-white shadow-xl shadow-emerald-600/30 hover:scale-[1.05] active:scale-95"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-emerald-400 to-blue-500 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  <span className="relative z-10 flex items-center gap-2">
                    {isLoading ? <Loader2 size={20} className="animate-spin" /> : <>¡LISTO PARA EMPEZAR! 🚀</>}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
