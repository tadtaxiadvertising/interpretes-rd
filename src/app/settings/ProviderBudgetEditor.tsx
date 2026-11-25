'use client';

import { useState } from 'react';
import type { ProviderQuota } from '@/lib/email/provider-quota';
import { providerCatalog } from '@/lib/email/provider-catalog';
import { quotaAvailability } from '@/lib/email/quota-availability';

type Props = {
  quota: ProviderQuota;
  disabled: boolean;
  onSave: (dailyLimit: number, monthlyLimit: number) => void;
};

export default function ProviderBudgetEditor({ quota, disabled, onSave }: Props) {
  const [daily, setDaily] = useState(String(quota.dailyLimit));
  const [monthly, setMonthly] = useState(String(quota.monthlyLimit));
  const dailyLimit = Number(daily);
  const monthlyLimit = Number(monthly);
  const caps = providerCatalog[quota.provider];
  const valid = daily.trim() !== '' && monthly.trim() !== ''
    && Number.isSafeInteger(dailyLimit) && Number.isSafeInteger(monthlyLimit)
    && dailyLimit >= 1 && dailyLimit <= caps.daily && monthlyLimit >= 1 && monthlyLimit <= caps.monthly;
  const changed = dailyLimit !== quota.dailyLimit || monthlyLimit !== quota.monthlyLimit;
  const preview = valid && quota.periodValid !== false
    ? quotaAvailability({ ...quota, dailyLimit, monthlyLimit }) : null;
  const increase = dailyLimit > quota.dailyLimit || monthlyLimit > quota.monthlyLimit;

  return (
    <form className="space-y-2" onSubmit={event => {
      event.preventDefault();
      if (!disabled && valid && changed) onSave(dailyLimit, monthlyLimit);
    }}>
      <fieldset disabled={disabled} className="space-y-2">
        <legend className="font-medium">Ajustar presupuesto local</legend>
        <label className="block">Máximo diario<input name="daily" type="number" min={1} max={caps.daily} step={1} required value={daily} onChange={event => setDaily(event.target.value)} className="block w-full rounded-lg border border-[var(--border)] bg-transparent p-2" /></label>
        <label className="block">Máximo mensual<input name="monthly" type="number" min={1} max={caps.monthly} step={1} required value={monthly} onChange={event => setMonthly(event.target.value)} className="block w-full rounded-lg border border-[var(--border)] bg-transparent p-2" /></label>
        <div aria-live="polite" className="text-xs space-y-1">
          {!valid ? <p>Introduce límites enteros dentro de los máximos permitidos.</p> : changed && preview ? <>
            <p>Vista previa local: quedarían {preview.dailyRemaining} intentos diarios y {preview.monthlyRemaining} mensuales; {preview.remaining} según ambos límites.</p>
            {preview.status === 'exhausted' && <p>El nuevo presupuesto bloquearía nuevos intentos durante el período actual.</p>}
          </> : changed ? <p>No se puede calcular la disponibilidad con un período inconsistente.</p> : <p>Sin cambios pendientes.</p>}
          {valid && changed && increase && <p>Estás aumentando un límite local. Comprueba el saldo real del proveedor antes de guardar.</p>}
        </div>
        <button type="submit" disabled={!valid || !changed} className="rounded-lg border border-[var(--border)] px-3 py-2 disabled:opacity-50">Guardar presupuesto</button>
        <button type="button" disabled={!changed} onClick={() => { setDaily(String(quota.dailyLimit)); setMonthly(String(quota.monthlyLimit)); }} className="ml-2 rounded-lg border border-[var(--border)] px-3 py-2 disabled:opacity-50">Restablecer valores</button>
      </fieldset>
      <p className="text-xs">Pausa el despacho para editar. El cambio no reinicia el consumo, no cambia tu plan ni garantiza envíos gratuitos. Configura un límite inferior al saldo de tu cuenta real.</p>
    </form>
  );
}
