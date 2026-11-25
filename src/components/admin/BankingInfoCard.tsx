'use client';

import React, { useState, useTransition, useCallback, useId } from 'react';
import {
  Landmark,
  Hash,
  IdCard,
  CreditCard,
  Check,
  AlertCircle,
  Pencil,
  X,
  Loader2,
  Wallet,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  adminUpdateOnboardingDetails,
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

interface BankingInfoCardProps {
  /** UserProfile ID — used for the adminUpdateOnboardingDetails server action */
  userId: string;
  /** Current banking data from the interpreter record */
  bankName: string | null;
  bankAccount: string | null;
  bankAccountType: string | null;
  bankCedula: string | null;
  /** Whether onboarding is complete (affects edit permissions hint) */
  onboardingComplete?: boolean;
  /** Compact variant for table/roster embedding */
  compact?: boolean;
}

export function BankingInfoCard({
  userId,
  bankName,
  bankAccount,
  bankAccountType,
  bankCedula,
  onboardingComplete,
  compact = false,
}: BankingInfoCardProps) {
  const fieldId = useId();
  const [editMode, setEditMode] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [editBankName, setEditBankName] = useState(bankName || '');
  const [editBankAccount, setEditBankAccount] = useState(bankAccount || '');
  const [editBankAccountType, setEditBankAccountType] = useState(bankAccountType || '');
  const [editBankCedula, setEditBankCedula] = useState(bankCedula || '');
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const hasBankingData = !!bankName && !!bankAccount && !!bankCedula;

  const errors = {
    bankName: !editBankName ? 'Selecciona un banco' : '',
    bankAccount: !editBankAccount
      ? 'Ingresa el número de cuenta'
      : editBankAccount.replace(/\D/g, '').length < 5
        ? 'Mínimo 5 dígitos'
        : '',
    bankAccountType: !editBankAccountType ? 'Selecciona el tipo de cuenta' : '',
    bankCedula: !editBankCedula
      ? 'Ingresa tu cédula o RNC'
      : !CEDULA_REGEX.test(editBankCedula)
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
    setEditBankCedula(formatted.slice(0, 13));
  }

  function handleAccountChange(raw: string) {
    setEditBankAccount(raw.replace(/\D/g, ''));
  }

  function handleCancel() {
    setEditMode(false);
    setTouched({});
    setEditBankName(bankName || '');
    setEditBankAccount(bankAccount || '');
    setEditBankAccountType(bankAccountType || '');
    setEditBankCedula(bankCedula || '');
  }

  function handleSave() {
    startTransition(async () => {
      const result = await adminUpdateOnboardingDetails({
        userId,
        bankName: editBankName,
        bankAccount: editBankAccount,
        bankAccountType: editBankAccountType,
        bankCedula: editBankCedula,
      });
      if (result.success) {
        setEditMode(false);
        setTouched({});
        toast.success('Datos bancarios actualizados');
      } else {
        toast.error(result.error || 'Error al actualizar datos bancarios');
      }
    });
  }

  // ── Compact variant (inline in roster cards) ──
  if (compact && !editMode) {
    return (
      <div className="pt-3 border-t border-[var(--border)] mt-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-[var(--text-tertiary)] font-bold uppercase tracking-wider flex items-center gap-1.5">
            <Wallet size={12} /> Datos bancarios
          </span>
          <button
            onClick={() => setEditMode(true)}
            className="p-1 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--theme-link)] hover:bg-blue-500/10 transition-all"
            title="Editar datos bancarios"
          >
            <Pencil size={12} />
          </button>
        </div>

        {hasBankingData ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div>
              <span className="text-[var(--text-tertiary)]">Banco</span>
              <p className="text-[var(--foreground)] font-medium truncate">{bankName}</p>
            </div>
            <div>
              <span className="text-[var(--text-tertiary)]">Tipo</span>
              <p className="text-[var(--foreground)] font-medium">{bankAccountType || '—'}</p>
            </div>
            <div className="col-span-2">
              <span className="text-[var(--text-tertiary)]">Cuenta</span>
              <p className="text-[var(--foreground)] font-mono font-medium">{bankAccount}</p>
            </div>
            <div className="col-span-2">
              <span className="text-[var(--text-tertiary)]">Cédula/RNC</span>
              <p className="text-[var(--foreground)] font-mono font-medium">{bankCedula}</p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-[var(--text-tertiary)] italic">Sin datos bancarios registrados</p>
        )}
      </div>
    );
  }

  // ── Full card variant ──
  return (
    <div className={cn(
      'rounded-[2rem] border transition-all duration-300 overflow-hidden',
      editMode
        ? 'bg-[var(--theme-panel)] border-blue-500/20 shadow-lg shadow-blue-950/20'
        : hasBankingData
          ? 'bg-[var(--theme-panel)] border-[var(--border)] hover:border-emerald-500/20'
          : 'bg-[var(--theme-panel)] border-[var(--border)] hover:border-red-500/20'
    )}>
      {/* Header */}
      <div className={cn(
        'px-4 sm:px-6 py-4 border-b flex flex-wrap items-center justify-between gap-2',
        editMode ? 'border-blue-500/20 bg-blue-500/5' : 'border-[var(--border)]'
      )}>
        <div className="flex items-center gap-3">
          <div className={cn(
            'p-2 rounded-xl transition-colors',
            editMode ? 'bg-blue-500/10 text-[var(--theme-link)]' : hasBankingData ? 'bg-emerald-500/10 text-[var(--theme-success)]' : 'bg-red-500/10 text-[var(--theme-danger)]'
          )}>
            <Wallet size={16} />
          </div>
          <div>
            <h4 className="text-sm font-bold text-[var(--foreground)]">Datos bancarios</h4>
            {!editMode && (
              <p className={cn('text-[11px]', hasBankingData ? 'text-[var(--theme-success)]' : 'text-[var(--theme-danger)]')}>
                {hasBankingData ? 'Datos completos — listo para pagar' : 'Sin datos bancarios'}
              </p>
            )}
          </div>
        </div>

        {!editMode && (
          <button
            onClick={() => setEditMode(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--theme-link)] hover:bg-blue-500/10 border border-[var(--border)] hover:border-blue-500/20 transition-all"
          >
            <Pencil size={14} /> Editar
          </button>
        )}
      </div>

      {/* Body */}
      <div className="px-4 sm:px-6 py-4">
        {editMode ? (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* Admin notice */}
            {onboardingComplete && (
              <div className="flex items-center gap-2 py-2 px-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-[var(--theme-warning)] mb-4">
                <ShieldCheck size={14} />
                <span>Onboarding completado — solo el administrador puede editar estos datos</span>
              </div>
            )}

            {/* Banco */}
            <div className="group">
              <label htmlFor={fieldId + '-bankName'} className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Banco *</label>
              <div className="relative">
                <Landmark className={cn(
                  'absolute left-3 top-1/2 -translate-y-1/2 transition-colors',
                  editBankName ? 'text-[var(--theme-link)]' : 'text-[var(--text-tertiary)]'
                )} size={16} />
                <select
                  id={fieldId + '-bankName'}
                  aria-invalid={Boolean(touched.bankName && errors.bankName)}
                  aria-describedby={touched.bankName && errors.bankName ? fieldId + '-bankName-error' : undefined}
                  value={editBankName}
                  onChange={(e) => setEditBankName(e.target.value)}
                  onBlur={() => markTouched('bankName')}
                  className={cn(
                    'w-full bg-[var(--theme-control-bg)] border rounded-xl py-2.5 pl-10 pr-8 text-sm text-[var(--theme-control-text)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-focus)] transition-all appearance-none cursor-pointer',
                    touched.bankName && errors.bankName ? 'border-[var(--theme-danger)]' : editBankName ? 'border-[var(--theme-control-border)]' : 'border-[var(--theme-control-border)]'
                  )}
                >
                  <option value="">Selecciona banco</option>
                  {RD_BANKS.map((b) => (
                    <option key={b.value} value={b.value}>{b.label}</option>
                  ))}
                </select>
              </div>
              {touched.bankName && errors.bankName && (
                <p id={fieldId + '-bankName-error'} className="mt-1 text-[11px] text-[var(--theme-danger)] flex items-center gap-1"><AlertCircle size={10} /> {errors.bankName}</p>
              )}
            </div>

            {/* Tipo de Cuenta */}
            <div className="group">
              <label htmlFor={fieldId + '-bankAccountType'} className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Tipo de Cuenta *</label>
              <div className="relative">
                <CreditCard className={cn(
                  'absolute left-3 top-1/2 -translate-y-1/2 transition-colors',
                  editBankAccountType ? 'text-[var(--theme-link)]' : 'text-[var(--text-tertiary)]'
                )} size={16} />
                <select
                  id={fieldId + '-bankAccountType'}
                  aria-invalid={Boolean(touched.bankAccountType && errors.bankAccountType)}
                  aria-describedby={touched.bankAccountType && errors.bankAccountType ? fieldId + '-bankAccountType-error' : undefined}
                  value={editBankAccountType}
                  onChange={(e) => setEditBankAccountType(e.target.value)}
                  onBlur={() => markTouched('bankAccountType')}
                  className={cn(
                    'w-full bg-[var(--theme-control-bg)] border rounded-xl py-2.5 pl-10 pr-8 text-sm text-[var(--theme-control-text)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-focus)] transition-all appearance-none cursor-pointer',
                    touched.bankAccountType && errors.bankAccountType ? 'border-[var(--theme-danger)]' : editBankAccountType ? 'border-[var(--theme-control-border)]' : 'border-[var(--theme-control-border)]'
                  )}
                >
                  <option value="">Selecciona tipo</option>
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              {touched.bankAccountType && errors.bankAccountType && (
                <p id={fieldId + '-bankAccountType-error'} className="mt-1 text-[11px] text-[var(--theme-danger)] flex items-center gap-1"><AlertCircle size={10} /> {errors.bankAccountType}</p>
              )}
            </div>

            {/* No. de Cuenta */}
            <div className="group">
              <label htmlFor={fieldId + '-bankAccount'} className="block text-xs font-medium text-[var(--text-secondary)] mb-1">No. de Cuenta *</label>
              <div className="relative">
                <Hash className={cn(
                  'absolute left-3 top-1/2 -translate-y-1/2 transition-colors',
                  editBankAccount && !errors.bankAccount ? 'text-[var(--theme-link)]' : 'text-[var(--text-tertiary)]'
                )} size={16} />
                <input
                  type="text"
                  inputMode="numeric"
                  id={fieldId + '-bankAccount'}
                  aria-invalid={Boolean(touched.bankAccount && errors.bankAccount)}
                  aria-describedby={touched.bankAccount && errors.bankAccount ? fieldId + '-bankAccount-error' : undefined}
                  value={editBankAccount}
                  onChange={(e) => handleAccountChange(e.target.value)}
                  onBlur={() => markTouched('bankAccount')}
                  placeholder="Ej: 0123456789"
                  className={cn(
                    'w-full bg-[var(--theme-control-bg)] border rounded-xl py-2.5 pl-10 pr-9 text-sm text-[var(--theme-control-text)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-focus)] transition-all',
                    touched.bankAccount && errors.bankAccount ? 'border-[var(--theme-danger)]' : editBankAccount && !errors.bankAccount ? 'border-[var(--theme-control-border)]' : 'border-[var(--theme-control-border)]'
                  )}
                />
                {editBankAccount && !errors.bankAccount && (
                  <Check className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--theme-success)]" size={16} />
                )}
              </div>
              {touched.bankAccount && errors.bankAccount && (
                <p id={fieldId + '-bankAccount-error'} className="mt-1 text-[11px] text-[var(--theme-danger)] flex items-center gap-1"><AlertCircle size={10} /> {errors.bankAccount}</p>
              )}
            </div>

            {/* Cédula / RNC */}
            <div className="group">
              <label htmlFor={fieldId + '-bankCedula'} className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Cédula / RNC *</label>
              <div className="relative">
                <IdCard className={cn(
                  'absolute left-3 top-1/2 -translate-y-1/2 transition-colors',
                  editBankCedula && !errors.bankCedula ? 'text-[var(--theme-link)]' : 'text-[var(--text-tertiary)]'
                )} size={16} />
                <input
                  type="text"
                  id={fieldId + '-bankCedula'}
                  aria-invalid={Boolean(touched.bankCedula && errors.bankCedula)}
                  aria-describedby={touched.bankCedula && errors.bankCedula ? fieldId + '-bankCedula-error' : undefined}
                  value={editBankCedula}
                  onChange={(e) => handleCedulaChange(e.target.value)}
                  onBlur={() => markTouched('bankCedula')}
                  placeholder="001-1234567-8"
                  maxLength={13}
                  className={cn(
                    'w-full bg-[var(--theme-control-bg)] border rounded-xl py-2.5 pl-10 pr-9 text-sm text-[var(--theme-control-text)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-focus)] transition-all',
                    touched.bankCedula && errors.bankCedula ? 'border-[var(--theme-danger)]' : editBankCedula && !errors.bankCedula ? 'border-[var(--theme-control-border)]' : 'border-[var(--theme-control-border)]'
                  )}
                />
                {editBankCedula && !errors.bankCedula && (
                  <Check className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--theme-success)]" size={16} />
                )}
              </div>
              {touched.bankCedula && errors.bankCedula && (
                <p id={fieldId + '-bankCedula-error'} className="mt-1 text-[11px] text-[var(--theme-danger)] flex items-center gap-1"><AlertCircle size={10} /> {errors.bankCedula}</p>
              )}
            </div>

            {isFormValid && (
              <div className="flex items-center gap-2 py-2 px-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-[var(--theme-success)] animate-in fade-in zoom-in duration-300">
                <Check size={12} /> Todos los campos validados
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
              <button
                onClick={handleCancel}
                className="theme-action-secondary px-4 py-2 rounded-xl text-sm font-medium transition-colors"
              >
                <X size={14} className="inline mr-1" /> Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={!isFormValid || isPending}
                className="theme-action-primary flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-bold transition-colors"
              >
                {isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Guardar
              </button>
            </div>
          </div>
        ) : (
          /* View mode */
          hasBankingData ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <InfoItem icon={<Landmark size={14} />} label="Banco" value={bankName!} color="blue" />
              <InfoItem icon={<CreditCard size={14} />} label="Tipo" value={bankAccountType || '—'} color="indigo" />
              <InfoItem icon={<Hash size={14} />} label="Cuenta" value={bankAccount!} color="blue" mono />
              <InfoItem icon={<IdCard size={14} />} label="Cédula/RNC" value={bankCedula!} color="indigo" mono />
            </div>
          ) : (
            <div className="py-6 text-center">
              <Wallet size={32} className="mx-auto text-[var(--text-tertiary)] mb-3" />
              <p className="text-[var(--text-tertiary)] text-sm">Sin datos bancarios registrados</p>
              <p className="text-[var(--text-tertiary)] text-xs mt-1">El intérprete debe completar el onboarding, o el administrador puede agregar los datos manualmente.</p>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function InfoItem({
  icon,
  label,
  value,
  color = 'blue',
  mono = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color?: 'blue' | 'indigo' | 'emerald';
  mono?: boolean;
}) {
  const iconColorMap = {
    blue: 'text-[var(--theme-link)]',
    indigo: 'text-[var(--theme-purple)]',
    emerald: 'text-[var(--theme-success)]',
  };

  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-xl bg-white/[0.02] border border-[var(--border)]">
      <div className={cn('p-1.5 rounded-lg', iconColorMap[color])}>{icon}</div>
      <div className="min-w-0">
        <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider font-bold">{label}</p>
        <p className={cn('text-sm text-[var(--foreground)] break-all', mono && 'font-mono')}>{value}</p>
      </div>
    </div>
  );
}
