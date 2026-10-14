"use client";

import { useState, useTransition } from "react";
import { submitApplicationAction } from "@/app/actions/recruitment";
import { ApplicantSchema, ApplicantData } from "@/lib/validators/recruitment";
import { User, FileText, PlaySquare, Mic, Calendar, UploadCloud, CheckCircle2, AlertCircle } from "lucide-react";

export default function RecruitmentFunnel() {
  const [step, setStep] = useState<number>(1);
  const [isPending, startTransition] = useTransition();
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

  return (
    <div className="max-w-3xl mx-auto p-6 bg-white border border-gray-200 rounded-xl shadow-sm">
      {/* Visual Progress */}
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-gray-100">
        <StepIndicator icon={User} label="Postulación" active={step >= 1} current={step === 1} />
        <StepIndicator icon={PlaySquare} label="Inducción" active={step >= 2} current={step === 2} />
        <StepIndicator icon={Mic} label="Roleplay" active={step >= 3} current={step === 3} />
        <StepIndicator icon={Calendar} label="Setup" active={step >= 4} current={step === 4} />
      </div>

      {/* STEP 1: Application Form */}
      {step === 1 && (
        <div className="space-y-6 animate-in fade-in">
          <h2 className="text-xl font-semibold text-gray-800">Inicia tu proceso de postulación</h2>
          
          {errorMsg && (
            <div className="p-3 bg-red-50 text-red-600 rounded-lg flex items-center gap-2 text-sm">
              <AlertCircle className="w-4 h-4" /> {errorMsg}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input 
              type="text" placeholder="Nombre completo" 
              className="p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})}
            />
            <input 
              type="email" placeholder="Correo electrónico" 
              className="p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})}
            />
            <input 
              type="tel" placeholder="Teléfono (Ej: +123456789)" 
              className="p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              value={formData.phone} onChange={(e) => setFormData({...formData, phone: e.target.value})}
            />
            <input
              type="text" required placeholder="País de residencia"
              className="p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              value={formData.country} onChange={(e) => setFormData({ ...formData, country: e.target.value })}
            />
            <select required aria-label="Nivel de inglés" className="p-3 border border-gray-300 rounded-lg bg-white"
              value={formData.englishLevel}
              onChange={(e) => setFormData({ ...formData, englishLevel: e.target.value as ApplicantData["englishLevel"] })}
            >
              <option value="B1">Inglés B1 — Intermedio</option>
              <option value="B2">Inglés B2 — Intermedio alto</option>
              <option value="C1">Inglés C1 — Avanzado</option>
              <option value="C2">Inglés C2 — Dominio</option>
            </select>
            <label className="flex flex-col gap-2 text-sm text-gray-600">
              Velocidad de descarga (Mbps)
              <input type="number" min={1} max={10000} step={1} required
                className="p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                value={formData.speedtestMbps}
                onChange={(e) => setFormData({ ...formData, speedtestMbps: Number(e.target.value) })}
              />
            </label>
            <input type="url" placeholder="Enlace al currículum (opcional, HTTPS)"
              className="p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              value={formData.cvUrl ?? ""}
              onChange={(e) => setFormData({ ...formData, cvUrl: e.target.value || undefined })}
            />
            <input 
              type="url" placeholder="Link de tu certificado EFSET" 
              className="p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              value={formData.efsetLink} onChange={(e) => setFormData({...formData, efsetLink: e.target.value})}
            />
          </div>

          <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 flex flex-col items-center justify-center text-gray-500">
            <UploadCloud className="w-8 h-8 mb-2" />
            <span className="text-sm">Revisa que los datos de contacto, nivel de inglés y conexión sean correctos.</span>
          </div>

          <button 
            onClick={handleApply} 
            disabled={isPending}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {isPending ? "Procesando..." : "Enviar Postulación"}
          </button>
        </div>
      )}

      {/* STEP 2: Materials & Induction */}
      {step === 2 && (
        <div className="space-y-6 animate-in fade-in">
          <h2 className="text-xl font-semibold text-gray-800">Conoce más sobre Intérpretes RD</h2>
          <p className="text-gray-600 text-sm">Visualiza este material antes de proceder a tu evaluación técnica.</p>
          
          <div className="aspect-video bg-gray-900 rounded-lg flex items-center justify-center relative overflow-hidden">
             <PlaySquare className="w-12 h-12 text-white/50" />
             <div className="absolute bottom-4 left-4 text-white font-medium text-sm">Video: Recompensas y Beneficios del Empleo</div>
          </div>

          <div className="flex gap-4">
            <button className="flex-1 border border-gray-200 p-4 rounded-lg flex items-center justify-center gap-2 hover:bg-gray-50 text-gray-700 font-medium transition-colors">
              <FileText className="w-5 h-5 text-blue-600" /> Descargar PDF Informativo
            </button>
            <button className="flex-1 border border-gray-200 p-4 rounded-lg flex items-center justify-center gap-2 hover:bg-gray-50 text-gray-700 font-medium transition-colors">
              <FileText className="w-5 h-5 text-green-600" /> Material de Estudio (Glosario)
            </button>
          </div>

          <button 
            onClick={() => setStep(3)} 
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-lg transition-colors"
          >
            Continuar al Roleplay
          </button>
        </div>
      )}

      {/* STEP 3: Assessment (Roleplay) */}
      {step === 3 && (
        <div className="space-y-6 animate-in fade-in text-center">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Mic className="w-8 h-8 text-blue-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-800">Evaluación Práctica (Roleplay)</h2>
          <p className="text-gray-600">Nuestro sistema o reclutador evaluará tu nivel de interpretación y protocolo. Basado en esta evaluación se actualizará tu <strong>resultRoleplay</strong> en el sistema.</p>
          
          <div className="p-6 bg-gray-50 border border-gray-200 rounded-lg text-left">
            <h3 className="font-medium text-gray-800 mb-2">Instrucciones:</h3>
            <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
              <li>Asegúrate de estar en un lugar silencioso.</li>
              <li>Mantén a mano el material de estudio (Glosario médico/legal).</li>
              <li>Haz click en iniciar cuando estés listo para grabar tu sesión.</li>
            </ul>
          </div>

          <button 
            onClick={() => setStep(4)} 
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-lg transition-colors"
          >
            Iniciar Simulador de Roleplay
          </button>
        </div>
      )}

      {/* STEP 4: Setup Meeting */}
      {step === 4 && (
        <div className="space-y-6 animate-in fade-in text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-800">¡Felicidades, has completado las pruebas!</h2>
          <p className="text-gray-600 mb-6">Como último paso, agenda tu reunión de Onboarding para configurar tus credenciales en el <strong>Portal Vault (RBAC)</strong>.</p>
          
          {/* Placeholder for Calendly/Cal.com Embed */}
          <div className="h-64 border border-gray-200 bg-gray-50 rounded-lg flex flex-col items-center justify-center">
             <Calendar className="w-10 h-10 text-gray-400 mb-2" />
             <span className="text-gray-500 font-medium">Embed de Calendly / Cal.com</span>
             <span className="text-sm text-gray-400">Selecciona tu horario para la entrevista.</span>
          </div>
        </div>
      )}
    </div>
  );
}

// Visual indicator component
function StepIndicator({ icon: Icon, label, active, current }: { icon: any, label: string, active: boolean, current: boolean }) {
  return (
    <div className={`flex flex-col items-center gap-2 ${active ? 'text-blue-600' : 'text-gray-400'}`}>
      <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors ${current ? 'border-blue-600 bg-blue-50' : active ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 bg-gray-50'}`}>
        <Icon className="w-5 h-5" />
      </div>
      <span className="text-xs font-semibold">{label}</span>
    </div>
  );
}