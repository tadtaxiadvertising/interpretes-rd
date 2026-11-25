// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BankFormRD } from './BankFormRD';

afterEach(() => cleanup());

describe('Interpreter bank form accessibility', () => {
  it('associates controls with labels, error messages and the existing format hint', () => {
    const onChange = vi.fn();
    render(<BankFormRD standalone onChange={onChange} />);
    const bank = screen.getByLabelText('Banco *');
    const type = screen.getByLabelText('Tipo de Cuenta *');
    const account = screen.getByLabelText('No. de Cuenta *') as HTMLInputElement;
    const cedula = screen.getByLabelText('Cédula / RNC *') as HTMLInputElement;
    for (const field of [bank, type, account, cedula]) {
      expect(field.className).toContain('bg-[var(--theme-control-bg)]');
      expect(field.className).toContain('border-[var(--theme-control-border)]');
      fireEvent.blur(field);
      expect(field.getAttribute('aria-invalid')).toBe('true');
      const errorId = field.getAttribute('aria-describedby')?.split(' ')[0];
      expect(errorId).toBeTruthy();
      expect(document.getElementById(errorId ?? '')?.textContent).toBeTruthy();
      expect(field.className).toContain('border-[var(--theme-danger)]');
    }
    fireEvent.change(bank, { target: { value: 'Popular' } });
    fireEvent.change(type, { target: { value: 'Ahorro' } });
    fireEvent.change(account, { target: { value: '01234abc' } });
    fireEvent.change(cedula, { target: { value: '00112345678' } });
    expect(account.value).toBe('01234');
    expect(cedula.value).toBe('001-1234567-8');
    expect(cedula.getAttribute('aria-describedby')).toBe('bank-cedula-format');
    for (const field of [bank, type, account, cedula]) {
      expect(field.getAttribute('aria-invalid')).toBe('false');
      expect(field.className).toContain('border-[var(--theme-control-border)]');
    }
    expect(screen.getByRole('status').textContent).toContain('Todos los campos');
    expect(onChange).toHaveBeenLastCalledWith({
      bankName: 'Popular', bankAccountType: 'Ahorro',
      bankAccount: '01234', bankCedula: '001-1234567-8',
    });
  });
});
