import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderQuota } from '@/lib/email/provider-quota';
import ProviderBudgetEditor from './ProviderBudgetEditor';

const quota: ProviderQuota = { provider: 'brevo', dailyLimit: 100, dailyUsed: 40, monthlyLimit: 500, monthlyUsed: 120, periodValid: true };
afterEach(cleanup);

describe('ProviderBudgetEditor', () => {
  it('previews remaining attempts and saves only changed valid limits', () => {
    const onSave = vi.fn();
    render(<ProviderBudgetEditor quota={quota} disabled={false} onSave={onSave} />);
    const save = screen.getByRole('button', { name: 'Guardar presupuesto' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Máximo diario'), { target: { value: '50' } });
    expect(screen.getByText(/quedarían 10 intentos diarios y 380 mensuales/)).toBeTruthy();
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledExactlyOnceWith(50, 500);
  });

  it('warns when reducing below usage or increasing a limit', () => {
    render(<ProviderBudgetEditor quota={quota} disabled={false} onSave={vi.fn()} />);
    const daily = screen.getByLabelText('Máximo diario');
    fireEvent.change(daily, { target: { value: '20' } });
    expect(screen.getByText(/bloquearía nuevos intentos/)).toBeTruthy();
    fireEvent.change(daily, { target: { value: '150' } });
    expect(screen.getByText(/Estás aumentando un límite local/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restablecer valores' }));
    expect((daily as HTMLInputElement).value).toBe('100');
    expect(screen.getByText('Sin cambios pendientes.')).toBeTruthy();
  });

  it('rejects empty and out-of-range values without saving', () => {
    const onSave = vi.fn();
    render(<ProviderBudgetEditor quota={quota} disabled={false} onSave={onSave} />);
    const save = screen.getByRole('button', { name: 'Guardar presupuesto' }) as HTMLButtonElement;
    for (const value of ['', '301', '1.5']) {
      fireEvent.change(screen.getByLabelText('Máximo diario'), { target: { value } });
      expect(save.disabled).toBe(true);
      fireEvent.click(save);
    }
    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not predict availability from an inconsistent period', () => {
    render(<ProviderBudgetEditor quota={{ ...quota, periodValid: false }} disabled={false} onSave={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Máximo diario'), { target: { value: '50' } });
    expect(screen.getByText(/No se puede calcular la disponibilidad/)).toBeTruthy();
    expect(screen.queryByText(/Vista previa local/)).toBeNull();
  });
});
