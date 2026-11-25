// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BankingInfoCard } from './BankingInfoCard';

vi.mock('@/app/actions/admin-onboarding', () => ({
  adminUpdateOnboardingDetails: vi.fn(),
}));

afterEach(() => cleanup());

describe('BankingInfoCard theme and accessibility', () => {
  it('uses semantic controls and associates validation errors without changing account formatting', () => {
    render(<BankingInfoCard userId="test-user" bankName={null} bankAccount={null} bankAccountType={null} bankCedula={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const bank = screen.getByLabelText('Banco *');
    const account = screen.getByLabelText('No. de Cuenta *') as HTMLInputElement;
    const cedula = screen.getByLabelText('Cédula / RNC *') as HTMLInputElement;
    const type = screen.getByLabelText('Tipo de Cuenta *');
    for (const field of [bank, account, cedula, type]) {
      expect(field.className).toContain('bg-[var(--theme-control-bg)]');
      expect(field.className).toContain('text-[var(--theme-control-text)]');
    }
    fireEvent.blur(bank);
    expect(bank.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(bank.getAttribute('aria-describedby') ?? '')?.textContent).toContain('Selecciona un banco');
    const save = screen.getByRole('button', { name: 'Guardar' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(bank, { target: { value: 'Popular' } });
    fireEvent.change(type, { target: { value: 'Ahorro' } });
    fireEvent.change(account, { target: { value: '01234abc' } });
    fireEvent.change(cedula, { target: { value: '00112345678' } });
    expect(account.value).toBe('01234');
    expect(cedula.value).toBe('001-1234567-8');
    expect(bank.getAttribute('aria-invalid')).toBe('false');
    expect(save.disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByLabelText('Banco *')).toBeNull();
  });
});
