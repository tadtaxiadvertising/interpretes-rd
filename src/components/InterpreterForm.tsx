'use client';

import React, { useState } from 'react';
import { Save, Loader2, User, Mail, Shield, DollarSign, Target, Briefcase, Lock } from 'lucide-react';
import { createInterpreter, updateInterpreter, resetInterpreterPassword } from '@/app/actions/interpreters';

interface InterpreterFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
   
  initialData?: any;
  interpreterId?: number;
}

export function InterpreterForm({ onSuccess, onCancel, initialData, interpreterId }: InterpreterFormProps) {
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
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-sm animate-in fade-in slide-in-from-top-2">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Nombre Completo</label>
          <div className="relative">
            <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input
              required
              name="name"
              defaultValue={initialData?.name}
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-12 pr-4 text-white focus:border-blue-500/50 transition-all outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder="Ej: Juan Pérez"
            />
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">ID Externo</label>
          <div className="relative">
            <Shield className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input
              required
              name="externalId"
              defaultValue={initialData?.externalId}
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-12 pr-4 text-white focus:border-blue-500/50 transition-all outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder="INT-001"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Email Corporativo</label>
          <div className="relative">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input
              required
              type="email"
              name="emailCorporativo"
              defaultValue={initialData?.emailCorporativo}
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-12 pr-4 text-white focus:border-blue-500/50 transition-all outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder="juan@interpretesrd.com"
            />
          </div>
        </div>
        {!interpreterId && (
          <div className="space-y-2">
            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Contraseña de Acceso</label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
              <input
                required={!interpreterId}
                type="password"
                name="password"
                className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-12 pr-4 text-white focus:border-blue-500/50 transition-all outline-none focus:ring-2 focus:ring-blue-500/20"
                placeholder="••••••••"
              />
            </div>
          </div>
        )}
        {interpreterId && (
          <div className="space-y-2">
             <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Cambiar Contraseña (Opcional)</label>
             <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type="password"
                  name="password"
                  className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-12 pr-4 text-white focus:border-blue-500/50 transition-all outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="Dejar en blanco para no cambiar"
                />
             </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Tarifa por Hora (RD$)</label>
          <div className="relative">
            <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input
              required
              type="number"
              step="0.01"
              name="hourlyTariff"
              defaultValue={initialData?.tariffPerMinute ? (parseFloat(initialData.tariffPerMinute) * 60).toFixed(2) : ''}
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-12 pr-4 text-white focus:border-blue-500/50 transition-all outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder="RD$ 9.00"
            />
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Estado Inicial</label>
          <div className="relative">
            <Target className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" size={18} />
            <select
              name="status"
              defaultValue={initialData?.status || 'Activo'}
              className="w-full bg-slate-900 border border-white/10 rounded-2xl py-3 pl-12 pr-4 text-white focus:border-blue-500/50 transition-all outline-none focus:ring-2 focus:ring-blue-500/20 appearance-none cursor-pointer"
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
          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Campaña Asignada</label>
          <div className="relative">
            <Briefcase className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input
              name="campaign"
              defaultValue={initialData?.campaign}
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-12 pr-4 text-white focus:border-blue-500/50 transition-all outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder="Salud / Healthcare"
            />
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Meta Mensual (Horas)</label>
          <div className="relative">
            <Target className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input
              required
              type="number"
              name="monthlyGoal"
              defaultValue={initialData?.monthlyGoal ? Math.round(initialData.monthlyGoal / 60) : 33}
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-12 pr-4 text-white focus:border-blue-500/50 transition-all outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder="33"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Frecuencia de Pago</label>
          <div className="relative">
            <Target className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" size={18} />
            <select
              name="paymentFrequency"
              defaultValue={initialData?.paymentFrequency || 'Monthly'}
              className="w-full bg-slate-900 border border-white/10 rounded-2xl py-3 pl-12 pr-4 text-white focus:border-blue-500/50 transition-all outline-none focus:ring-2 focus:ring-blue-500/20 appearance-none cursor-pointer"
            >
              <option value="Weekly">Semanal (Weekly)</option>
              <option value="Biweekly">Quincenal (Biweekly)</option>
              <option value="Monthly">Mensual (Monthly)</option>
            </select>
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Día de Pago (1-31 o Día de la Semana)</label>
          <div className="relative">
            <Briefcase className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input
              name="paymentDay"
              defaultValue={initialData?.paymentDay || '1'}
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-12 pr-4 text-white focus:border-blue-500/50 transition-all outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder="Ej: 1, 15 o Monday"
            />
          </div>
        </div>
      </div>

      <div className="flex gap-4 pt-4">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-4 bg-white/5 hover:bg-white/10 text-gray-400 rounded-2xl font-bold transition-all border border-white/10 active:scale-95"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={loading}
          className="flex-1 py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-bold transition-all glow flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95"
        >
          {loading ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
          {interpreterId ? 'Actualizar Interprete' : 'Guardar Interprete'}
        </button>
      </div>
    </form>
  );
}
