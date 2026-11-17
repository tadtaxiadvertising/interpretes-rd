import React from 'react';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { 
  Settings, 
  CreditCard, 
  User, 
  MapPin, 
  Phone, 
  Save,
  Shield,
  Info,
  Edit,
  Eye,
  EyeOff
} from 'lucide-react';
import { getCurrentProfile } from '@/app/actions/auth';
import prisma from '@/lib/prisma';
import { updateInterpreterProfileFromForm } from '@/app/actions/profile';
import { BankFormRD } from '@/components/BankFormRD';

export const dynamic = 'force-dynamic';

function maskAccount(account: string): string {
  if (!account) return '—';
  const visible = account.slice(-4);
  return `••••${visible}`;
}

function maskCedula(cedula: string): string {
  if (!cedula) return '—';
  // Format: XXX-XXXXXXX-X → mask middle digits
  return cedula.replace(/(\d{3})-(\d{7})-(\d{1})/, '$1-•••••••-$3');
}

export default async function SettingsPage() {
  const { userId } = await auth();
  if (!userId) redirect('/login');

  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');

  const db = prisma;
  const interpreter = profile.interpreter_id 
    ? await db.interpreter.findUnique({ 
        where: { id: profile.interpreter_id },
        select: {
          id: true,
          name: true,
          emailCorporativo: true,
          telefono: true,
          pais: true,
          banco: true,
          cuentaPago: true,
          tipoCuenta: true,
          cedulaRnc: true,
        }
      })
    : null;

  if (!interpreter && profile.role === 'interpreter') {
    console.error('❌ SETTINGS: Interpreter record missing for user', profile.id);
  }

  const onboardingComplete = profile.onboarding_complete;
  const hasBankingData = interpreter 
    ? !!(interpreter.banco && interpreter.cuentaPago && interpreter.cedulaRnc)
    : !!(profile.bank_name && profile.bank_account && profile.bank_cedula);

  const showBankingForm = !onboardingComplete && !hasBankingData;

  return (
    <div className="max-w-4xl space-y-8 animate-in fade-in duration-700">
      <header>
        <h2 className="text-3xl font-bold text-white flex items-center gap-3">
          <Settings className="text-blue-400" />
          Configuración del perfil
        </h2>
        <p className="text-gray-400 mt-2">Administra tu información personal y tus preferencias de pago.</p>
      </header>

      <form action={updateInterpreterProfileFromForm} className="space-y-6">
        
        {/* Personal Info */}
        <div className="glass p-8 rounded-3xl border border-white/5 space-y-6">
          <div className="flex items-center gap-3 pb-4 border-b border-white/5">
            <User className="text-blue-400" size={20} />
            <h3 className="text-lg font-bold text-white">Información personal</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Nombre completo</label>
              <input 
                type="text" 
                disabled 
                value={interpreter?.name || profile.display_name}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-gray-400 cursor-not-allowed"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Correo electrónico</label>
              <input 
                type="text" 
                disabled 
                value={interpreter?.emailCorporativo || profile.email || ''}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-gray-400 cursor-not-allowed"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Número de teléfono</label>
              <div className="relative">
                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                <input 
                  name="phone"
                  type="text" 
                  defaultValue={interpreter?.telefono || ''}
                  placeholder="+1 234 567 890"
                  className="w-full bg-white/5 border border-white/10 focus:border-blue-500/50 rounded-xl px-12 py-3 text-white focus:outline-none transition-all"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">País de residencia</label>
              <div className="relative">
                <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                <input 
                  name="country"
                  type="text" 
                  defaultValue={interpreter?.pais || ''}
                  placeholder="Ej.: República Dominicana"
                  className="w-full bg-white/5 border border-white/10 focus:border-blue-500/50 rounded-xl px-12 py-3 text-white focus:outline-none transition-all"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Payment Info */}
        <div className="glass p-8 rounded-3xl border border-white/5 space-y-6">
          <div className="flex items-center gap-3 pb-4 border-b border-white/5">
            <CreditCard className="text-green-400" size={20} />
            <h3 className="text-lg font-bold text-white">Preferencias de pago (República Dominicana)</h3>
          </div>

          {showBankingForm ? (
            // Show BankFormRD only if onboarding not complete and no banking data yet
            <BankFormRD 
              standalone={true}
              initialData={{
                bankName: '',
                bankAccount: '',
                bankAccountType: '',
                bankCedula: '',
              }}
            />
          ) : (
            // Show masked summary with "Solicitar cambio" action
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-green-500/5 border border-green-500/10 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center">
                    <CreditCard className="text-green-400" size={20} />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">Método de pago</p>
                    <p className="text-xs text-green-400">{onboardingComplete ? 'Verificado' : (hasBankingData ? 'Registrado' : 'Pendiente')}</p>
                  </div>
                </div>
                {hasBankingData && (
                  <button
                    type="button"
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-all"
                    onClick={() => window.location.href = '/dashboard/settings/banking-change'}
                  >
                    <Edit size={16} />
                    Solicitar cambio
                  </button>
                )}
              </div>

              {hasBankingData && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Banco</label>
                    <p className="text-white font-mono">{interpreter?.banco || profile.bank_name || '—'}</p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Tipo de cuenta</label>
                    <p className="text-white font-mono">{interpreter?.tipoCuenta || profile.bank_account_type || '—'}</p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Cuenta bancaria</label>
                    <p className="text-white font-mono">{maskAccount(interpreter?.cuentaPago || profile.bank_account || '')}</p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Cédula o RNC</label>
                    <p className="text-white font-mono">{maskCedula(interpreter?.cedulaRnc || profile.bank_cedula || '')}</p>
                  </div>
                </div>
              )}

              {!hasBankingData && !onboardingComplete && (
                <div className="p-4 rounded-2xl bg-amber-500/5 border border-amber-500/10 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Info className="text-amber-400 shrink-0" size={20} />
                    <p className="text-xs text-amber-400">
                      Completa tu onboarding para registrar tu método de pago.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="p-4 rounded-2xl bg-blue-500/5 border border-blue-500/10 flex gap-4">
            <Info className="text-blue-400 shrink-0" size={20} />
            <p className="text-xs text-gray-400 leading-relaxed">
              Los pagos se procesan cada 15 días en pesos dominicanos (DOP). Verifica que la cédula o el RNC coincida con la identidad del titular de la cuenta bancaria para evitar rechazos.
            </p>
          </div>
        </div>

        {/* Submit Button - only for personal info changes */}
        <div className="flex justify-end pt-4">
          <button 
            type="submit"
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-8 py-4 rounded-2xl font-bold transition-all glow group"
          >
            <Save size={20} className="group-hover:scale-110 transition-transform" />
            Guardar cambios personales
          </button>
        </div>
      </form>

      {/* Security Info */}
      <footer className="flex items-center justify-center gap-2 text-gray-600 text-xs py-8">
        <Shield size={14} />
        Tus datos se protegen mediante medidas de seguridad y se gestionan conforme a las normas de privacidad y regulación bancaria aplicables.
      </footer>
    </div>
  );
}