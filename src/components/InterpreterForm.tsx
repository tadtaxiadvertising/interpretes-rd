'use client';

import React, { useId, useState } from 'react';
import { Save, Loader2, User, Mail, Shield, DollarSign, Target, Briefcase, Lock } from 'lucide-react';
import { createInterpreter, updateInterpreter, resetInterpreterPassword } from '@/app/actions/interpreters';

interface InterpreterFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
   
  initialData?: any;
  interpreterId?: number;
}

export function InterpreterForm({ onSuccess, onCancel, initialData, interpreterId }: InterpreterFormProps) {
  const formId = useId();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const isEditing = !!interpreterId;
    
    const data: Record<string, unknown> = {
      name: formData.get('name'),
      externalId: formData.get('externalId'),
      emailCorporativo: formData.get('emailCorporativo'),
      tariffPerMinute: parseFloat(formData.get('hourlyTariff') as string) / 60,
      status: formData.get('status'),
      campaign: formData.get('campaign'),
      monthlyGoal: Math.round(parseFloat(formData.get('monthlyGoal') as string || '33.3') * 60),
      paymentFrequency: formData.get('paymentFrequency'),
      paymentDay: formData.get('paymentDay'),
    };

    const password = formData.get('password');
    if (password) {
      data.password = password;
    }

    try {
      let result;
      if (isEditing) {
        result = await updateInterpreter(interpreterId, data as any);
        if (result?.success && password) {
          const pwdResult = await resetInterpreterPassword(interpreterId, password.toString());
          if (!pwdResult?.success) {
            throw new Error(pwdResult?.error || 'Error al actualizar la contraseña');
          }
        }
      } else {
        result = await createInterpreter(data as any);
      }

      if (!result || !result.success) {
        throw new Error(result?.error || 'Error de conexión o respuesta inválida del servidor al guardar el intérprete.');
      }

      onSuccess?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setLoading(false);
    }
  };


  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div role="alert" className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-[var(--theme-danger)] animate-in fade-in slide-in-from-top-2">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <label htmlFor={`${formId}-name`} className="ml-1 text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">Nombre Completo</label>
          <div className="relative">
            <User className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" size={18} />
            <input
              required
              id={`${formId}-name`}
              name="name"
              defaultValue={initialData?.name}
              className="w-full rounded-2xl border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] py-3 pl-12 pr-4 text-[var(--foreground)] placeholder:text-[var(--text-muted)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-focus)]"
              placeholder="Ej: Juan Pérez"
            />
          </div>
        </div>
        <div className="space-y-2">
          <label htmlFor={`${formId}-externalId`} className="ml-1 text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">ID Externo</label>
          <div className="relative">
            <Shield className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" size={18} />
            <input
              required
              id={`${formId}-externalId`}
              name="externalId"
              defaultValue={initialData?.externalId}
              className="w-full rounded-2xl border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] py-3 pl-12 pr-4 text-[var(--foreground)] placeholder:text-[var(--text-muted)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-focus)]"
              placeholder="INT-001"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <label htmlFor={`${formId}-emailCorporativo`} className="ml-1 text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">Email Corporativo</label>
          <div className="relative">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" size={18} />
            <input
              required
              type="email"
              id={`${formId}-emailCorporativo`}
              name="emailCorporativo"
              defaultValue={initialData?.emailCorporativo}
              className="w-full rounded-2xl border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] py-3 pl-12 pr-4 text-[var(--foreground)] placeholder:text-[var(--text-muted)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-focus)]"
              placeholder="juan@interpretesrd.com"
            />
          </div>
        </div>
        {!interpreterId && (
          <div className="space-y-2">
            <label htmlFor={`${formId}-password`} className="ml-1 text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">Contraseña de Acceso</label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" size={18} />
              <input
                required={!interpreterId}
                type="password"
                id={`${formId}-password`}
                name="password"
                className="w-full rounded-2xl border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] py-3 pl-12 pr-4 text-[var(--foreground)] placeholder:text-[var(--text-muted)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-focus)]"
                placeholder="••••••••"
              />
            </div>
          </div>
        )}
        {interpreterId && (
          <div className="space-y-2">
             <label htmlFor={`${formId}-password`} className="ml-1 text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">Cambiar Contraseña (Opcional)</label>
             <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" size={18} />
                <input
                  type="password"
                  id={`${formId}-password`}
                  name="password"
                  className="w-full rounded-2xl border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] py-3 pl-12 pr-4 text-[var(--foreground)] placeholder:text-[var(--text-muted)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-focus)]"
                  placeholder="Dejar en blanco para no cambiar"
                />
             </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <label htmlFor={`${formId}-hourlyTariff`} className="ml-1 text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">Tarifa por Hora (RD$)</label>
          <div className="relative">
            <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" size={18} />
            <input
              required
              type="number"
              step="0.01"
              id={`${formId}-hourlyTariff`}
              name="hourlyTariff"
              defaultValue={initialData?.tariffPerMinute ? (parseFloat(initialData.tariffPerMinute) * 60).toFixed(2) : ''}
              className="w-full rounded-2xl border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] py-3 pl-12 pr-4 text-[var(--foreground)] placeholder:text-[var(--text-muted)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-focus)]"
              placeholder="RD$ 9.00"
            />
          </div>
        </div>
        <div className="space-y-2">
          <label htmlFor={`${formId}-status`} className="ml-1 text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">Estado Inicial</label>
          <div className="relative">
            <Target className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] pointer-events-none" size={18} />
            <select
              id={`${formId}-status`}
              name="status"
              defaultValue={initialData?.status || 'Activo'}
              className="w-full cursor-pointer appearance-none rounded-2xl border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] py-3 pl-12 pr-4 text-[var(--foreground)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-focus)]"
            >
              <option value="Activo">Activo</option>
              <option value="Training">Training</option>
              <option value="Probation">Probation</option>
              <option value="Inactivo">Inactivo</option>
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <label htmlFor={`${formId}-campaign`} className="ml-1 text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">Campaña Asignada</label>
          <div className="relative">
            <Briefcase className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" size={18} />
            <input
              id={`${formId}-campaign`}
              name="campaign"
              defaultValue={initialData?.campaign}
              className="w-full rounded-2xl border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] py-3 pl-12 pr-4 text-[var(--foreground)] placeholder:text-[var(--text-muted)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-focus)]"
              placeholder="Salud / Healthcare"
            />
          </div>
        </div>
        <div className="space-y-2">
          <label htmlFor={`${formId}-monthlyGoal`} className="ml-1 text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">Meta Mensual (Horas)</label>
          <div className="relative">
            <Target className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" size={18} />
            <input
              required
              type="number"
              id={`${formId}-monthlyGoal`}
              name="monthlyGoal"
              defaultValue={initialData?.monthlyGoal ? Math.round(initialData.monthlyGoal / 60) : 33}
              className="w-full rounded-2xl border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] py-3 pl-12 pr-4 text-[var(--foreground)] placeholder:text-[var(--text-muted)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-focus)]"
              placeholder="33"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <label htmlFor={`${formId}-paymentFrequency`} className="ml-1 text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">Frecuencia de Pago</label>
          <div className="relative">
            <Target className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] pointer-events-none" size={18} />
            <select
              id={`${formId}-paymentFrequency`}
              name="paymentFrequency"
              defaultValue={initialData?.paymentFrequency || 'Monthly'}
              className="w-full cursor-pointer appearance-none rounded-2xl border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] py-3 pl-12 pr-4 text-[var(--foreground)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-focus)]"
            >
              <option value="Weekly">Semanal (Weekly)</option>
              <option value="Biweekly">Quincenal (Biweekly)</option>
              <option value="Monthly">Mensual (Monthly)</option>
            </select>
          </div>
        </div>
        <div className="space-y-2">
          <label htmlFor={`${formId}-paymentDay`} className="ml-1 text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">Día de Pago (1-31 o Día de la Semana)</label>
          <div className="relative">
            <Briefcase className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" size={18} />
            <input
              id={`${formId}-paymentDay`}
              name="paymentDay"
              defaultValue={initialData?.paymentDay || '1'}
              className="w-full rounded-2xl border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] py-3 pl-12 pr-4 text-[var(--foreground)] placeholder:text-[var(--text-muted)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-focus)]"
              placeholder="Ej: 1, 15 o Monday"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 pt-4 sm:flex-nowrap">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-2xl border border-[var(--border)] bg-[var(--theme-hover)] py-4 font-bold text-[var(--foreground)] transition-colors hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-focus)]"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={loading}
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-[#1764bf] py-4 font-bold text-white transition-colors hover:bg-[#1554a8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-focus)] disabled:opacity-50"
        >
          {loading ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
          {interpreterId ? 'Actualizar Interprete' : 'Guardar Interprete'}
        </button>
      </div>
    </form>
  );
}
