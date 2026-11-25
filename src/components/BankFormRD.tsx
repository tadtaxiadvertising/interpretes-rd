'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Landmark, Hash, IdCard, CreditCard, AlertCircle, Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── RD Bank Enum ──────────────────────────────────────────────────
// Maintained as Single Source of Truth — matches ADR-004
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

// ── Dominican Cédula format: XXX-XXXXXXX-X ──
const CEDULA_REGEX = /^\d{3}-\d{7}-\d{1}$/;

export interface BankFormData {
  bankName: string;
  bankAccount: string;
  bankAccountType: string;
  bankCedula: string;
}

interface BankFormRDProps {
  /** Initial values (for pre-filling when editing) */
  initialData?: Partial<BankFormData>;
  /** Called when all fields are valid and user submits */
  onSubmit?: (data: BankFormData) => void;
  /** Called whenever any field changes (real-time sync) */
  onChange?: (data: BankFormData) => void;
  /** External loading state (e.g. from useTransition) */
  isLoading?: boolean;
  /** If true, render as standalone card. If false, render just the fields. */
  standalone?: boolean;
}

/**
 * BankFormRD — Banking details form exclusive to Dominican Republic.
 *
 * Validates:
 * - Bank selection from curated RD bank list
 * - Account number (numeric, min 5 chars)
 * - Account type (Ahorro/Corriente)
 * - Cédula/RNC in Dominican format (XXX-XXXXXXX-X)
 *
 * Used by:
 * - OnboardingWizard (Step 2)
 * - Interpreter profile editor (admin)
 */
export function BankFormRD({ initialData, onSubmit, onChange, standalone = false }: BankFormRDProps) {
  const [bankName, setBankName] = useState(initialData?.bankName || '');
  const [bankAccount, setBankAccount] = useState(initialData?.bankAccount || '');
  const [bankAccountType, setBankAccountType] = useState(initialData?.bankAccountType || '');
  const [bankCedula, setBankCedula] = useState(initialData?.bankCedula || '');
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // ── Sync with parent ──
  useEffect(() => {
    if (onChange) {
      onChange({ bankName, bankAccount, bankAccountType, bankCedula });
    }
  }, [bankName, bankAccount, bankAccountType, bankCedula, onChange]);

  // ── Validation ──
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

  const isValid = Object.values(errors).every((e) => e === '');

  const markTouched = useCallback((field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }, []);

  // ── Auto-format cédula as user types ──
  function handleCedulaChange(raw: string) {
    const digits = raw.replace(/[^\d]/g, '');
    let formatted = digits;
    if (digits.length > 3) formatted = digits.slice(0, 3) + '-' + digits.slice(3);
    if (digits.length > 10) formatted = digits.slice(0, 3) + '-' + digits.slice(3, 10) + '-' + digits.slice(10, 11);
    setBankCedula(formatted.slice(0, 13));
  }

  // ── Account number: only digits ──
  function handleAccountChange(raw: string) {
    setBankAccount(raw.replace(/\D/g, ''));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    onSubmit?.({ bankName, bankAccount, bankAccountType, bankCedula });
  }

  const Wrapper = standalone ? 'div' : 'form';
  const wrapperProps = standalone ? {} : { onSubmit: handleSubmit };

  return (
    <Wrapper {...(wrapperProps as any)} className="space-y-5">
      {/* Banco */}
      <div className="group">
        <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5 transition-colors group-focus-within:text-[var(--theme-link)]">
          Banco *
        </label>
        <div className="relative">
          <Landmark className={cn(
            "absolute left-4 top-1/2 -translate-y-1/2 transition-colors duration-300",
            bankName ? "text-[var(--theme-link)]" : "text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]"
          )} size={18} />
          
          <select
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            onBlur={() => markTouched('bankName')}
            id="bank-name-select"
            className={cn(
              "w-full bg-[var(--theme-control-bg)] border rounded-2xl py-3.5 pl-12 pr-10 text-[var(--theme-control-text)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-focus)] transition-all appearance-none cursor-pointer hover:bg-[var(--theme-hover)]",
              touched.bankName && errors.bankName
                ? "border-red-500/50 bg-red-500/5"
                : bankName 
                  ? "border-blue-500/30" 
                  : "border-[var(--theme-control-border)]"
            )}
          >
            <option value="">Selecciona tu banco</option>
            {RD_BANKS.map((bank) => (
              <option key={bank.value} value={bank.value}>{bank.label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] pointer-events-none group-hover:text-[var(--text-secondary)] transition-colors" size={18} />
        </div>
        {touched.bankName && errors.bankName && (
          <p className="mt-1.5 text-xs text-[var(--theme-danger)] flex items-center gap-1 animate-in slide-in-from-top-1 duration-200">
            <AlertCircle size={12} /> {errors.bankName}
          </p>
        )}
      </div>

      {/* Tipo de Cuenta */}
      <div className="group">
        <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5 transition-colors group-focus-within:text-[var(--theme-link)]">
          Tipo de Cuenta *
        </label>
        <div className="relative">
          <CreditCard className={cn(
            "absolute left-4 top-1/2 -translate-y-1/2 transition-colors duration-300",
            bankAccountType ? "text-[var(--theme-link)]" : "text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]"
          )} size={18} />
          <select
            value={bankAccountType}
            onChange={(e) => setBankAccountType(e.target.value)}
            onBlur={() => markTouched('bankAccountType')}
            id="bank-account-type-select"
            className={cn(
              "w-full bg-[var(--theme-control-bg)] border rounded-2xl py-3.5 pl-12 pr-10 text-[var(--theme-control-text)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-focus)] transition-all appearance-none cursor-pointer hover:bg-[var(--theme-hover)]",
              touched.bankAccountType && errors.bankAccountType
                ? "border-red-500/50 bg-red-500/5"
                : bankAccountType
                  ? "border-blue-500/30"
                  : "border-[var(--theme-control-border)]"
            )}
          >
            <option value="">Selecciona tipo de cuenta</option>
            {ACCOUNT_TYPES.map((type) => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] pointer-events-none group-hover:text-[var(--text-secondary)] transition-colors" size={18} />
        </div>
        {touched.bankAccountType && errors.bankAccountType && (
          <p className="mt-1.5 text-xs text-[var(--theme-danger)] flex items-center gap-1 animate-in slide-in-from-top-1 duration-200">
            <AlertCircle size={12} /> {errors.bankAccountType}
          </p>
        )}
      </div>

      {/* No. de Cuenta */}
      <div className="group">
        <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5 transition-colors group-focus-within:text-[var(--theme-link)]">
          No. de Cuenta *
        </label>
        <div className="relative">
          <Hash className={cn(
            "absolute left-4 top-1/2 -translate-y-1/2 transition-colors duration-300",
            bankAccount && !errors.bankAccount ? "text-[var(--theme-link)]" : "text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]"
          )} size={18} />
          <input
            type="text"
            inputMode="numeric"
            value={bankAccount}
            onChange={(e) => handleAccountChange(e.target.value)}
            onBlur={() => markTouched('bankAccount')}
            placeholder="Ej: 0123456789"
            id="bank-account-input"
            className={cn(
              "w-full bg-[var(--theme-control-bg)] border rounded-2xl py-3.5 pl-12 pr-4 text-[var(--theme-control-text)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-focus)] transition-all hover:bg-[var(--theme-hover)]",
              touched.bankAccount && errors.bankAccount
                ? "border-red-500/50 bg-red-500/5"
                : bankAccount && !errors.bankAccount
                  ? "border-blue-500/30"
                  : "border-[var(--theme-control-border)]"
            )}
          />
          {bankAccount && !errors.bankAccount && (
            <Check className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--theme-success)] animate-in fade-in zoom-in duration-300" size={18} />
          )}
        </div>
        {touched.bankAccount && errors.bankAccount && (
          <p className="mt-1.5 text-xs text-[var(--theme-danger)] flex items-center gap-1 animate-in slide-in-from-top-1 duration-200">
            <AlertCircle size={12} /> {errors.bankAccount}
          </p>
        )}
      </div>

      {/* Cédula / RNC */}
      <div className="group">
        <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5 transition-colors group-focus-within:text-[var(--theme-link)]">
          Cédula / RNC *
        </label>
        <div className="relative">
          <IdCard className={cn(
            "absolute left-4 top-1/2 -translate-y-1/2 transition-colors duration-300",
            bankCedula && !errors.bankCedula ? "text-[var(--theme-link)]" : "text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]"
          )} size={18} />
          <input
            type="text"
            value={bankCedula}
            onChange={(e) => handleCedulaChange(e.target.value)}
            onBlur={() => markTouched('bankCedula')}
            placeholder="001-1234567-8"
            id="bank-cedula-input"
            maxLength={13}
            className={cn(
              "w-full bg-[var(--theme-control-bg)] border rounded-2xl py-3.5 pl-12 pr-4 text-[var(--theme-control-text)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-focus)] transition-all hover:bg-[var(--theme-hover)]",
              touched.bankCedula && errors.bankCedula
                ? "border-red-500/50 bg-red-500/5"
                : bankCedula && !errors.bankCedula
                  ? "border-blue-500/30"
                  : "border-[var(--theme-control-border)]"
            )}
          />
          {bankCedula && !errors.bankCedula && (
            <Check className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--theme-success)] animate-in fade-in zoom-in duration-300" size={18} />
          )}
        </div>
        {touched.bankCedula && errors.bankCedula && (
          <p className="mt-1.5 text-xs text-[var(--theme-danger)] flex items-center gap-1 animate-in slide-in-from-top-1 duration-200">
            <AlertCircle size={12} /> {errors.bankCedula}
          </p>
        )}
        <p className="mt-1.5 text-[11px] text-[var(--text-tertiary)] ml-1">Formato dominicano: XXX-XXXXXXX-X</p>
      </div>

      {/* Validity indicator */}
      {isValid && (
        <div className="flex items-center gap-2 py-2 px-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-[var(--theme-success)] animate-in fade-in zoom-in duration-500">
          <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <Check size={12} />
          </div>
          <span className="font-medium">Todos los campos están completos y validados</span>
        </div>
      )}
    </Wrapper>
  );
}

/** Export validation check for parent components */
export function isBankFormValid(data: Partial<BankFormData>): boolean {
  return !!(
    data.bankName?.trim() &&
    data.bankAccount?.trim() &&
    (data.bankAccount?.replace(/\D/g, '').length ?? 0) >= 5 &&
    data.bankAccountType?.trim() &&
    data.bankCedula?.trim() &&
    CEDULA_REGEX.test(data.bankCedula || '')
  );
}
