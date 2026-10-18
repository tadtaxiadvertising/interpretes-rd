"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitApplicationAction } from "@/app/actions/recruitment";
import { startCandidateRoleplay } from "@/app/actions/roleplay";
import { ApplicantSchema, ApplicantData } from "@/lib/validators/recruitment";
import { User, PlaySquare, Mic, Calendar, UploadCloud, CheckCircle2, AlertCircle } from "lucide-react";

export default function RecruitmentFunnel() {
  const router = useRouter();
  const [step, setStep] = useState<number>(1);
  const [isPending, startTransition] = useTransition();
  const [isStartingRoleplay, setIsStartingRoleplay] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState<ApplicantData>({
    name: "",
    email: "",
    phone: "",
    country: "",
    englishLevel: "B2",
    speedtestMbps: 25,
    efsetLink: "",
    cvUrl: undefined,
  });

  const handleApply = () => {
    setErrorMsg(null);
    startTransition(async () => {
      const validation = ApplicantSchema.safeParse(formData);
      
      if (!validation.success) {
        setErrorMsg(validation.error.issues[0].message);
        return;
      }

      const result = await submitApplicationAction(validation.data);
      if (result.success) {
        setStep(2); // Advance to materials section
      } else {
        setErrorMsg(result.error || "Ocurrió un error inesperado.");
      }
    });
  };

  const handleStartRoleplay = () => {
    setErrorMsg(null);
    setIsStartingRoleplay(true);
    startTransition(async () => {
      const result = await startCandidateRoleplay();
      setIsStartingRoleplay(false);

      if (result.success) {
        router.push(`/roleplays/${result.data.sessionId}`);
        return;
      }

      if ("requiresAuth" in result && result.requiresAuth) {
        setErrorMsg("Para continuar con el roleplay necesitas iniciar sesión o registrarte con el mismo correo de tu postulación. Redirigiendo…");
        setTimeout(() => router.push("/login?next=/postular"), 1500);
        return;
      }

      setErrorMsg(result.error || "No se pudo iniciar el roleplay.");
    });
  };

  return (
    <div className="mx-auto w-full max-w-4xl rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-[0_24px_80px_rgba(2,6,23,0.28)] sm:p-7 md:p-8">
      {/* Visual Progress */}
      <div className="flex items-center justify-between mb-8 border-b border-slate-200 pb-5">
        <StepIndicator icon={User} label="Postulación" active={step >= 1} current={step === 1} />
        <StepIndicator icon={PlaySquare} label="Inducción" active={step >= 2} current={step === 2} />
        <StepIndicator icon={Mic} label="Roleplay" active={step >= 3} current={step === 3} />
        <StepIndicator icon={Calendar} label="Setup" active={step >= 4} current={step === 4} />
      </div>

      {/* STEP 1: Application Form */}
      {step === 1 && (
        <div className="space-y-6 animate-in fade-in">
          <h2 className="text-xl font-bold tracking-tight text-slate-900">Inicia tu proceso de postulación</h2>
          
          {errorMsg && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm font-medium text-red-700">
              <AlertCircle className="w-4 h-4" /> {errorMsg}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-4">
            <input 
              type="text" placeholder="Nombre completo" 
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-sm font-medium text-slate-900 placeholder:text-slate-500 shadow-sm outline-none transition duration-200 hover:border-slate-400 focus:border-[#2675ff] focus:ring-4 focus:ring-[#2675ff]/15"
              value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})}
            />
            <input 
              type="email" placeholder="Correo electrónico" 
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-sm font-medium text-slate-900 placeholder:text-slate-500 shadow-sm outline-none transition duration-200 hover:border-slate-400 focus:border-[#2675ff] focus:ring-4 focus:ring-[#2675ff]/15"
              value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})}
            />
            <input 
              type="tel" placeholder="Teléfono (Ej: +123456789)" 
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-sm font-medium text-slate-900 placeholder:text-slate-500 shadow-sm outline-none transition duration-200 hover:border-slate-400 focus:border-[#2675ff] focus:ring-4 focus:ring-[#2675ff]/15"
              value={formData.phone} onChange={(e) => setFormData({...formData, phone: e.target.value})}
            />
            <input
              type="text" required placeholder="País de residencia"
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-sm font-medium text-slate-900 placeholder:text-slate-500 shadow-sm outline-none transition duration-200 hover:border-slate-400 focus:border-[#2675ff] focus:ring-4 focus:ring-[#2675ff]/15"
              value={formData.country} onChange={(e) => setFormData({ ...formData, country: e.target.value })}
            />
            <select required aria-label="Nivel de inglés" className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-sm font-medium text-slate-900 shadow-sm outline-none transition hover:border-slate-400 focus:border-[#2675ff] focus:ring-4 focus:ring-[#2675ff]/15"
              value={formData.englishLevel}
              onChange={(e) => setFormData({ ...formData, englishLevel: e.target.value as ApplicantData["englishLevel"] })}
            >
              <option value="B1">Inglés B1 — Intermedio</option>
              <option value="B2">Inglés B2 — Intermedio alto</option>
              <option value="C1">Inglés C1 — Avanzado</option>
              <option value="C2">Inglés C2 — Dominio</option>
            </select>
            <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
              Velocidad de descarga (Mbps)
              <input type="number" min={1} max={10000} step={1} required
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-sm font-medium text-slate-900 placeholder:text-slate-500 shadow-sm outline-none transition duration-200 hover:border-slate-400 focus:border-[#2675ff] focus:ring-4 focus:ring-[#2675ff]/15"
                value={formData.speedtestMbps}
                onChange={(e) => setFormData({ ...formData, speedtestMbps: Number(e.target.value) })}
              />
            </label>
            <input type="url" placeholder="Enlace al currículum (opcional, HTTPS)"
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-sm font-medium text-slate-900 placeholder:text-slate-500 shadow-sm outline-none transition duration-200 hover:border-slate-400 focus:border-[#2675ff] focus:ring-4 focus:ring-[#2675ff]/15"
              value={formData.cvUrl ?? ""}
              onChange={(e) => setFormData({ ...formData, cvUrl: e.target.value || undefined })}
            />
            <input 
              type="url" placeholder="Link de tu certificado EFSET" 
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-sm font-medium text-slate-900 placeholder:text-slate-500 shadow-sm outline-none transition duration-200 hover:border-slate-400 focus:border-[#2675ff] focus:ring-4 focus:ring-[#2675ff]/15"
              value={formData.efsetLink} onChange={(e) => setFormData({...formData, efsetLink: e.target.value})}
            />
          </div>

          <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-5 py-6 text-center text-slate-600">
            <UploadCloud className="w-8 h-8 mb-2" />
            <span className="text-sm">Revisa que los datos de contacto, nivel de inglés y conexión sean correctos.</span>
          </div>

          <button 
            onClick={handleApply} 
            disabled={isPending}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#2675ff] px-5 py-3.5 font-bold text-white shadow-lg shadow-[#2675ff]/20 transition hover:bg-[#1765ef] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#2675ff]/30 disabled:cursor-not-allowed disabled:bg-slate-400 disabled:shadow-none"
          >
            {isPending ? "Procesando..." : "Enviar Postulación"}
          </button>
        </div>
      )}

      {/* STEP 2: Materials & Induction */}
      {step === 2 && (
        <div className="space-y-6 animate-in fade-in">
          <h2 className="text-xl font-semibold text-slate-900">Conoce más sobre Intérpretes RD</h2>
          <p className="text-slate-600 text-sm">Continúa cuando estés listo para tu evaluación técnica.</p>

          <button 
            onClick={() => setStep(3)} 
            className="w-full rounded-xl bg-[#2675ff] px-5 py-3.5 font-bold text-white shadow-lg shadow-[#2675ff]/20 transition hover:bg-[#1765ef] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#2675ff]/30"
          >
            Continuar al Roleplay
          </button>
        </div>
      )}

      {/* STEP 3: Assessment (Roleplay) */}
      {step === 3 && (
        <div className="space-y-6 animate-in fade-in text-center">
          <div className="w-16 h-16 bg-[#2675ff]/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <Mic className="w-8 h-8 text-[#2675ff]" />
          </div>
          <h2 className="text-xl font-semibold text-slate-900">Evaluación Práctica (Roleplay)</h2>
          <p className="text-slate-600">Nuestro sistema o reclutador evaluará tu nivel de interpretación y protocolo. Basado en esta evaluación se actualizará tu <strong>resultRoleplay</strong> en el sistema.</p>
          
          <div className="p-6 bg-slate-50 border border-slate-200 rounded-lg text-left">
            <h3 className="font-medium text-slate-900 mb-2">Instrucciones:</h3>
            <ul className="list-disc list-inside text-sm text-slate-600 space-y-1">
              <li>Asegúrate de estar en un lugar silencioso.</li>
              <li>Mantén a mano el material de estudio (Glosario médico/legal).</li>
              <li>Haz click en iniciar cuando estés listo para grabar tu sesión.</li>
            </ul>
          </div>

          {errorMsg && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3.5 text-left text-sm font-medium text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0" /> {errorMsg}
            </div>
          )}

          <button 
            onClick={handleStartRoleplay} 
            disabled={isStartingRoleplay || isPending}
            className="w-full rounded-xl bg-[#2675ff] px-5 py-3.5 font-bold text-white shadow-lg shadow-[#2675ff]/20 transition hover:bg-[#1765ef] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#2675ff]/30 disabled:cursor-not-allowed disabled:bg-slate-400 disabled:shadow-none"
          >
            {isStartingRoleplay || isPending ? "Iniciando…" : "Iniciar Simulador de Roleplay"}
          </button>
        </div>
      )}

      {/* STEP 4: Setup Meeting */}
      {step === 4 && (
        <div className="space-y-6 animate-in fade-in text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-xl font-semibold text-slate-900">Agenda tu entrevista de Onboarding</h2>
          <p className="text-slate-600 mb-6">Una vez completado y revisado tu roleplay, agenda tu reunión de Onboarding para configurar tus credenciales en el <strong>Portal Vault (RBAC)</strong>.</p>
          
          {/* Placeholder for Calendly/Cal.com Embed */}
          <div className="h-64 border border-slate-200 bg-slate-50 rounded-lg flex flex-col items-center justify-center">
             <Calendar className="w-10 h-10 text-slate-500 mb-2" />
             <span className="text-slate-600 font-medium">Embed de Calendly / Cal.com</span>
             <span className="text-sm text-slate-500">Selecciona tu horario para la entrevista.</span>
          </div>
        </div>
      )}
    </div>
  );
}

// Visual indicator component
function StepIndicator({ icon: Icon, label, active, current }: { icon: any, label: string, active: boolean, current: boolean }) {
  return (
    <div className={`flex min-w-0 flex-col items-center gap-2 text-center ${active ? 'text-[#2675ff]' : 'text-slate-500'}`}>
      <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors ${current ? 'border-[#2675ff] bg-[#2675ff]/10 text-[#2675ff]' : active ? 'border-[#2675ff] bg-[#2675ff] text-white' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
        <Icon className="w-5 h-5" />
      </div>
      <span className="text-xs font-semibold">{label}</span>
    </div>
  );
}