'use client';

import React, { useState, useEffect, useTransition, useCallback } from 'react';
import {
  X,
  Landmark,
  Hash,
  IdCard,
  CreditCard,
  Check,
  ChevronDown,
  AlertCircle,
  RotateCcw,
  Save,
  Loader2,
  ShieldCheck,
  Link as LinkIcon,
  CalendarCheck,
  CalendarX,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  getOnboardingDetails,
  adminUpdateOnboardingDetails,
  adminResetOnboarding,
  type OnboardingDetailData,
} from '@/app/actions/admin-onboarding';
import toast from 'react-hot-toast';

const RD_BANKS = [
  { value: 'Banreservas', label: 'Banco de Reservas' },
  { value: 'Popular', label: 'Banco Popular Dominicano' },
  { value: 'BHD', label: 'BHD León' },
  { value: 'Scotiabank', label: 'Scotiabank RD' },
  { value: 'Santa Cruz', label: 'Banco Santa Cruz' },
  { value: 'BDI', label: 'Banco BDI' },
  { value: 'Promerica', label: 'Banco Promerica' },
  { value: 'Caribe', label: 'Banco Caribe' },
  { value: 'Otro', label: 'Otro' },
] as const;

const ACCOUNT_TYPES = [
  { value: 'Ahorro', label: 'Cuenta de Ahorro' },
  { value: 'Corriente', label: 'Cuenta Corriente' },
] as const;

const CEDULA_REGEX = /^\d{3}-\d{7}-\d{1}$/;

interface InterpreterOnboardingPanelProps {
  userId: string;
  onClose: () => void;
}

export function InterpreterOnboardingPanel({ userId, onClose }: InterpreterOnboardingPanelProps) {
  const [details, setDetails] = useState<OnboardingDetailData | null>(null);
  const [isFetching, setIsFetching] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [editMode, setEditMode] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const [bankName, setBankName] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [bankAccountType, setBankAccountType] = useState('');
  const [bankCedula, setBankCedula] = useState('');
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  useEffect(() => {
    async function load() {
      setIsFetching(true);
      const result = await getOnboardingDetails(userId);
      if (result.success && result.data) {
        setDetails(result.data);
        setBankName(result.data.bankName || '');
        setBankAccount(result.data.bankAccount || '');
        setBankAccountType(result.data.bankAccountType || '');
        setBankCedula(result.data.bankCedula || '');
      } else {
        toast.error(result.error || 'Error loading onboarding data');
        onClose();
      }
      setIsFetching(false);
    }
    load();
  }, [userId, onClose]);

  const errors = {
    bankName: !bankName ? 'Selecciona un banco' : '',
    bankAccount: !bankAccount
      ? 'Ingresa el número de cuenta'
      : bankAccount.replace(/\D/g, '').length < 5
        ? 'Mínimo 5 dígitos'
        : '',
    bankAccountType: !bankAccountType ? 'Selecciona el tipo de cuenta' : '',
    bankCedula: !bankCedula
      ? 'Ingresa tu cédula o RNC'
      : !CEDULA_REGEX.test(bankCedula)
        ? 'Formato: XXX-XXXXXXX-X'
        : '',
  };

  const isFormValid = Object.values(errors).every((e) => e === '');

  const markTouched = useCallback((field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }, []);

  function handleCedulaChange(raw: string) {
    const digits = raw.replace(/[^\d]/g, '');
    let formatted = digits;
    if (digits.length > 3) formatted = digits.slice(0, 3) + '-' + digits.slice(3);
    if (digits.length > 10) formatted = digits.slice(0, 3) + '-' + digits.slice(3, 10) + '-' + digits.slice(10, 11);
    setBankCedula(formatted.slice(0, 13));
  }

  function handleAccountChange(raw: string) {
    setBankAccount(raw.replace(/\D/g, ''));
  }

  function handleSave() {
    startTransition(async () => {
      const result = await adminUpdateOnboardingDetails({
        userId,
        bankName,
        bankAccount,
        bankAccountType,
        bankCedula,
      });
      if (result.success && result.data) {
        setDetails(result.data);
        setEditMode(false);
        setTouched({});
        toast.success('Datos de onboarding actualizados');
      } else {
        toast.error(result.error || 'Error al actualizar datos');
      }
    });
  }

  function handleReset() {
    startTransition(async () => {
      const result = await adminResetOnboarding({ userId });
      if (result.success) {
        setDetails((prev) =>
          prev
            ? {
              ...prev,
              onboardingComplete: false,
              termsAcceptedAt: null,
              signatureDate: null,
              bankName: null,
              bankAccount: null,
              bankAccountType: null,
              bankCedula: null,
            }
            : prev
        );
        setBankName('');
        setBankAccount('');
        setBankAccountType('');
        setBankCedula('');
        setEditMode(false);
        setConfirmReset(false);
        setTouched({});
        toast.success('Onboarding reseteado — el intérprete deberá completarlo de nuevo');
      } else {
        toast.error(result.error || 'Error al resetear onboarding');
      }
    });
  }

  if (isFetching) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md">
        <div className="relative w-full max-w-2xl animate-in fade-in zoom-in-95 duration-500">
          <div className="bg-slate-900 border border-white/10 rounded-[2.5rem] shadow-2xl p-12 flex items-center justify-center">
            <Loader2 size={32} className="animate-spin text-blue-400" />
            <span className="ml-4 text-slate-400 font-medium">Cargando datos de onboarding...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!details) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md">
      <div className="relative w-full max-w-2xl animate-in fade-in zoom-in-95 duration-500">
        <div className="absolute -top-20 -left-20 w-64 h-64 bg-blue-500/20 rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-indigo-500/20 rounded-full blur-[100px] pointer-events-none" />

        <div className="relative bg-slate-900 border border-white/10 rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
          {/* Header */}
          <div className="px-10 pt-10 pb-6 border-b border-white/5">
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-2xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  <ShieldCheck size={24} />
                </div>
                <div>
                  <h2 className="text-2xl font-extrabold text-white tracking-tight">
                    Onboarding &amp; Pagos
                  </h2>
                  <p className="text-slate-400 text-sm mt-1">Panel de administración — datos del intérprete</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition-all"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-4 p-4 rounded-2xl bg-slate-950/60 border border-white/5">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow-lg">
                {details.displayName?.charAt(0) || details.email.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-white truncate">{details.displayName || 'Sin Nombre'}</p>
                <p className="text-xs text-slate-400 truncate">{details.email}</p>
              </div>
              {details.interpreterId && (
                <div className="flex items-center gap-1.5 text-sm font-medium text-blue-400">
                  <LinkIcon size={14} />
                  <span>{details.interpreterName}</span>
                </div>
              )}
              <div className={cn(
                'px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider border',
                details.onboardingComplete
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-red-500/10 text-red-400 border-red-500/20'
              )}>
                {details.onboardingComplete ? 'ONBOARDING COMPLETO' : 'ONBOARDING PENDIENTE'}
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="px-10 py-8 overflow-y-auto flex-1 custom-scrollbar">
            {/* Status indicators */}
            <div className="grid grid-cols-2 gap-4 mb-8">
              <div className={cn(
                'p-4 rounded-2xl border flex items-center gap-3',
                details.termsAcceptedAt
                  ? 'bg-emerald-500/5 border-emerald-500/20'
                  : 'bg-red-500/5 border-red-500/20'
              )}>
                {details.termsAcceptedAt ? (
                  <CalendarCheck size={20} className="text-emerald-400 shrink-0" />
                ) : (
                  <CalendarX size={20} className="text-red-400 shrink-0" />
                )}
                <div>
                  <p className="text-sm font-bold text-white">Acuerdo Legal</p>
                  <p className={cn('text-xs', details.termsAcceptedAt ? 'text-emerald-400' : 'text-red-400')}>
                    {details.termsAcceptedAt
                      ? `Aceptado: ${new Date(details.termsAcceptedAt).toLocaleDateString()}`
                      : 'No aceptado'}
                  </p>
                </div>
              </div>

              <div className={cn(
                'p-4 rounded-2xl border flex items-center gap-3',
                details.bankName && details.bankAccount && details.bankCedula
                  ? 'bg-emerald-500/5 border-emerald-500/20'
                  : 'bg-red-500/5 border-red-500/20'
              )}>
                {details.bankName && details.bankAccount && details.bankCedula ? (
                  <CreditCard size={20} className="text-emerald-400 shrink-0" />
                ) : (
                  <CreditCard size={20} className="text-red-400 shrink-0" />
                )}
                <div>
                  <p className="text-sm font-bold text-white">Datos Bancarios</p>
                  <p className={cn('text-xs', details.bankName ? 'text-emerald-400' : 'text-red-400')}>
                    {details.bankName ? `Banco: ${details.bankName}` : 'Sin datos bancarios'}
                  </p>
                </div>
              </div>
            </div>

            {/* Banking details — View or Edit */}
            {editMode ? (
              <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex items-center gap-2 mb-6">
                  <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    <Save size={16} />
                  </div>
                  <h3 className="text-lg font-bold text-white">Editando Datos Bancarios</h3>
                </div>

                {/* Banco */}
                <div className="group">
                  <label className="block text-sm font-medium text-slate-400 mb-1.5 transition-colors group-focus-within:text-blue-400">
                    Banco *
                  </label>
                  <div className="relative">
                    <Landmark className={cn(
                      'absolute left-4 top-1/2 -translate-y-1/2 transition-colors duration-300',
                      bankName ? 'text-blue-400' : 'text-slate-500'
                    )} size={18} />
                    <select
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                      onBlur={() => markTouched('bankName')}
                      className={cn(
                        'w-full bg-slate-900/50 border rounded-2xl py-3.5 pl-12 pr-10 text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all appearance-none cursor-pointer hover:bg-slate-800/50',
                        touched.bankName && errors.bankName
                          ? 'border-red-500/50 bg-red-500/5'
                          : bankName
                            ? 'border-blue-500/30'
                            : 'border-white/10'
                      )}
                    >
                      <option value="" className="bg-slate-900">Selecciona tu banco</option>
                      {RD_BANKS.map((bank) => (
                        <option key={bank.value} value={bank.value} className="bg-slate-900">{bank.label}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" size={18} />
                  </div>
                  {touched.bankName && errors.bankName && (
                    <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
                      <AlertCircle size={12} /> {errors.bankName}
                    </p>
                  )}
                </div>

                {/* Tipo de Cuenta */}
                <div className="group">
                  <label className="block text-sm font-medium text-slate-400 mb-1.5 transition-colors group-focus-within:text-blue-400">
                    Tipo de Cuenta *
                  </label>
                  <div className="relative">
                    <CreditCard className={cn(
                      'absolute left-4 top-1/2 -translate-y-1/2 transition-colors duration-300',
                      bankAccountType ? 'text-blue-400' : 'text-slate-500'
                    )} size={18} />
                    <select
                      value={bankAccountType}
                      onChange={(e) => setBankAccountType(e.target.value)}
                      onBlur={() => markTouched('bankAccountType')}
                      className={cn(
                        'w-full bg-slate-900/50 border rounded-2xl py-3.5 pl-12 pr-10 text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all appearance-none cursor-pointer hover:bg-slate-800/50',
                        touched.bankAccountType && errors.bankAccountType
                          ? 'border-red-500/50 bg-red-500/5'
                          : bankAccountType
                            ? 'border-blue-500/30'
                            : 'border-white/10'
                      )}
                    >
                      <option value="" className="bg-slate-900">Selecciona tipo de cuenta</option>
                      {ACCOUNT_TYPES.map((type) => (
                        <option key={type.value} value={type.value} className="bg-slate-900">{type.label}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" size={18} />
                  </div>
                  {touched.bankAccountType && errors.bankAccountType && (
                    <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
                      <AlertCircle size={12} /> {errors.bankAccountType}
                    </p>
                  )}
                </div>

                {/* No. de Cuenta */}
                <div className="group">
                  <label className="block text-sm font-medium text-slate-400 mb-1.5 transition-colors group-focus-within:text-blue-400">
                    No. de Cuenta *
                  </label>
                  <div className="relative">
                    <Hash className={cn(
                      'absolute left-4 top-1/2 -translate-y-1/2 transition-colors duration-300',
                      bankAccount && !errors.bankAccount ? 'text-blue-400' : 'text-slate-500'
                    )} size={18} />
                    <input
                      type="text"
                      inputMode="numeric"
                      value={bankAccount}
                      onChange={(e) => handleAccountChange(e.target.value)}
                      onBlur={() => markTouched('bankAccount')}
                      placeholder="Ej: 0123456789"
                      className={cn(
                        'w-full bg-slate-900/50 border rounded-2xl py-3.5 pl-12 pr-4 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all hover:bg-slate-800/50',
                        touched.bankAccount && errors.bankAccount
                          ? 'border-red-500/50 bg-red-500/5'
                          : bankAccount && !errors.bankAccount
                            ? 'border-blue-500/30'
                            : 'border-white/10'
                      )}
                    />
                    {bankAccount && !errors.bankAccount && (
                      <Check className="absolute right-4 top-1/2 -translate-y-1/2 text-emerald-400" size={18} />
                    )}
                  </div>
                  {touched.bankAccount && errors.bankAccount && (
                    <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
                      <AlertCircle size={12} /> {errors.bankAccount}
                    </p>
                  )}
                </div>

                {/* Cédula / RNC */}
                <div className="group">
                  <label className="block text-sm font-medium text-slate-400 mb-1.5 transition-colors group-focus-within:text-blue-400">
                    Cédula / RNC *
                  </label>
                  <div className="relative">
                    <IdCard className={cn(
                      'absolute left-4 top-1/2 -translate-y-1/2 transition-colors duration-300',
                      bankCedula && !errors.bankCedula ? 'text-blue-400' : 'text-slate-500'
                    )} size={18} />
                    <input
                      type="text"
                      value={bankCedula}
                      onChange={(e) => handleCedulaChange(e.target.value)}
                      onBlur={() => markTouched('bankCedula')}
                      placeholder="001-1234567-8"
                      maxLength={13}
                      className={cn(
                        'w-full bg-slate-900/50 border rounded-2xl py-3.5 pl-12 pr-4 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all hover:bg-slate-800/50',
                        touched.bankCedula && errors.bankCedula
                          ? 'border-red-500/50 bg-red-500/5'
                          : bankCedula && !errors.bankCedula
                            ? 'border-blue-500/30'
                            : 'border-white/10'
                      )}
                    />
                    {bankCedula && !errors.bankCedula && (
                      <Check className="absolute right-4 top-1/2 -translate-y-1/2 text-emerald-400" size={18} />
                    )}
                  </div>
                  {touched.bankCedula && errors.bankCedula && (
                    <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
                      <AlertCircle size={12} /> {errors.bankCedula}
                    </p>
                  )}
                  <p className="mt-1.5 text-[11px] text-slate-500 ml-1">Formato dominicano: XXX-XXXXXXX-X</p>
                </div>

                {isFormValid && (
                  <div className="flex items-center gap-2 py-2 px-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 animate-in fade-in zoom-in duration-500">
                    <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
                      <Check size={12} />
                    </div>
                    <span className="font-medium">Todos los campos están completos y validados</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4 animate-in fade-in duration-500">
                <div className="grid grid-cols-2 gap-4">
                  <DetailCard
                    icon={<Landmark size={18} />}
                    label="Banco"
                    value={details.bankName}
                    fallback="Sin banco"
                    color="blue"
                  />
                  <DetailCard
                    icon={<CreditCard size={18} />}
                    label="Tipo de Cuenta"
                    value={details.bankAccountType}
                    fallback="Sin tipo"
                    color="indigo"
                  />
                </div>
                <DetailCard
                  icon={<Hash size={18} />}
                  label="No. de Cuenta"
                  value={details.bankAccount}
                  fallback="Sin número de cuenta"
                  color="blue"
                  wide
                />
                <DetailCard
                  icon={<IdCard size={18} />}
                  label="Cédula / RNC"
                  value={details.bankCedula}
                  fallback="Sin cédula registrada"
                  color="indigo"
                  wide
                />
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-10 py-6 border-t border-white/5 bg-slate-900/50 backdrop-blur-sm flex items-center justify-between gap-4">
            {confirmReset ? (
              <div className="flex items-center gap-3">
                <p className="text-xs text-red-400 font-medium">¿Confirmar reset? El intérprete deberá completar el onboarding de nuevo.</p>
                <button
                  onClick={handleReset}
                  disabled={isPending}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-red-600 text-white hover:bg-red-500 transition-all disabled:opacity-50"
                >
                  {isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  Confirmar Reset
                </button>
                <button
                  onClick={() => setConfirmReset(false)}
                  className="px-4 py-2 rounded-xl text-sm text-slate-400 hover:text-white hover:bg-white/5 transition-all"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmReset(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-all"
              >
                <RotateCcw size={16} /> Resetear Onboarding
              </button>
            )}

            <div className="flex gap-3">
              {editMode ? (
                <>
                  <button
                    onClick={() => {
                      setEditMode(false);
                      setTouched({});
                      setBankName(details.bankName || '');
                      setBankAccount(details.bankAccount || '');
                      setBankAccountType(details.bankAccountType || '');
                      setBankCedula(details.bankCedula || '');
                    }}
                    className="px-6 py-3 rounded-2xl text-slate-400 font-bold hover:text-white hover:bg-white/5 transition-all"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={!isFormValid || isPending}
                    className={cn(
                      'group relative flex items-center gap-2 px-8 py-3 rounded-2xl font-bold transition-all duration-500 overflow-hidden',
                      isFormValid && !isPending
                        ? 'bg-emerald-600 text-white shadow-xl shadow-emerald-600/30 hover:scale-[1.02] active:scale-95'
                        : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    )}
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-emerald-400 to-blue-500 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                    <span className="relative z-10 flex items-center gap-2">
                      {isPending ? <Loader2 size={18} className="animate-spin" /> : <><Save size={18} /> Guardar Cambios</>}
                    </span>
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setEditMode(true)}
                  className="group relative flex items-center gap-2 px-8 py-3 rounded-2xl font-bold transition-all duration-500 overflow-hidden bg-blue-600 text-white shadow-xl shadow-blue-600/30 hover:scale-[1.02] active:scale-95"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  <span className="relative z-10 flex items-center gap-2">
                    <Save size={18} /> Editar Datos
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

function DetailCard({
  icon,
  label,
  value,
  fallback,
  color = 'blue',
  wide = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null | undefined;
  fallback: string;
  color?: 'blue' | 'indigo' | 'emerald';
  wide?: boolean;
}) {
  const hasValue = !!value;
  const bgMap = {
    blue: hasValue ? 'bg-blue-500/5 border-blue-500/20' : 'bg-slate-800/20 border-white/5',
    indigo: hasValue ? 'bg-indigo-500/5 border-indigo-500/20' : 'bg-slate-800/20 border-white/5',
    emerald: hasValue ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-slate-800/20 border-white/5',
  };
  const iconColorMap = {
    blue: hasValue ? 'text-blue-400' : 'text-slate-500',
    indigo: hasValue ? 'text-indigo-400' : 'text-slate-500',
    emerald: hasValue ? 'text-emerald-400' : 'text-slate-500',
  };

  return (
    <div className={cn(
      'p-4 rounded-2xl border flex items-center gap-4',
      bgMap[color],
      wide && 'col-span-2'
    )}>
      <div className={cn('p-2 rounded-xl', iconColorMap[color])}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">{label}</p>
        <p className={cn(
          'text-sm font-bold truncate',
          hasValue ? 'text-white' : 'text-slate-600 italic'
        )}>
          {value || fallback}
        </p>
      </div>
    </div>
  );
}
