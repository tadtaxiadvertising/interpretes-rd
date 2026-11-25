// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlobalGoalsButton } from './GlobalGoalsButton';
import { PayrateEditor } from './PayrateEditor';
import { AccountRateManager } from './AccountRateManager';

vi.mock('@/app/actions/settings', () => ({ updateSystemConfig: vi.fn() }));
vi.mock('@/app/actions/payrates', () => ({ updatePayrate: vi.fn() }));
vi.mock('@/app/actions/account-rates', () => ({
  getAccounts: vi.fn(async () => ({ success: true, data: [] })),
  setInterpreterAccountRate: vi.fn(),
  deleteInterpreterAccountRate: vi.fn(),
}));

afterEach(() => cleanup());

describe('goal and rate control appearance', () => {
  it('provides a labelled global goal field and shared dialog actions', () => {
    render(<GlobalGoalsButton initialGoal={120} />);
    fireEvent.click(screen.getByRole('button', { name: 'Configurar metas' }));
    const field = screen.getByLabelText('Meta mensual estándar (horas)') as HTMLInputElement;
    expect(field.value).toBe('120');
    expect(field.className).toContain('bg-[var(--theme-control-bg)]');
    expect(screen.getByRole('button', { name: 'Guardar cambios' }).className).toContain('theme-action-primary');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the hourly rate conversion and keyboard cancellation unchanged', () => {
    render(<table><tbody><PayrateEditor interpreter={{ id: 1, name: 'Ejemplo', externalId: 'TEST', campaign: null, status: 'Activo', tariffPerMinute: 2, accountRates: [] }} /></tbody></table>);
    fireEvent.click(screen.getByRole('button', { name: 'Editar tarifa' }));
    const input = screen.getByLabelText('Tarifa por hora en pesos dominicanos') as HTMLInputElement;
    expect(input.value).toBe('120.00');
    expect(input.className).toContain('text-[var(--theme-control-text)]');
    fireEvent.change(input, { target: { value: '150' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Editar tarifa' }));
    expect((screen.getByLabelText('Tarifa por hora en pesos dominicanos') as HTMLInputElement).value).toBe('120.00');
  });

  it('keeps special rate controls labelled and submission disabled when empty', async () => {
    render(<AccountRateManager interpreterId={1} initialRates={[]} />);
    const select = await screen.findByLabelText('Cuenta para tarifa especial');
    expect(select.className).toContain('bg-[var(--theme-control-bg)]');
    expect(screen.getByLabelText('Tarifa por hora en pesos dominicanos').className).toContain('text-[var(--theme-control-text)]');
    expect((screen.getByRole('button', { name: 'Asignar tarifa' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
