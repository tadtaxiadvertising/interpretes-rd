// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/app/actions/interpreters', () => ({
  createInterpreter: vi.fn(),
  updateInterpreter: vi.fn(),
  resetInterpreterPassword: vi.fn(),
}));
import { InterpreterForm } from './InterpreterForm';

afterEach(() => cleanup());

describe('Interpreter form contrast and accessible field labels', () => {
  it('uses theme-aware fields and associates every label in create mode', () => {
    render(<InterpreterForm />);
    for (const name of [
      'Nombre Completo', 'ID Externo', 'Email Corporativo',
      'Contraseña de Acceso', 'Tarifa por Hora (RD$)', 'Estado Inicial',
      'Campaña Asignada', 'Meta Mensual (Horas)', 'Frecuencia de Pago',
      'Día de Pago (1-31 o Día de la Semana)',
    ]) {
      const field = screen.getByLabelText(name);
      expect(field).toBeTruthy();
      expect(field.className).toContain('bg-[var(--theme-control-bg)]');
      expect(field.className).toContain('text-[var(--foreground)]');
    }
    const password = screen.getByLabelText('Contraseña de Acceso');
    expect(password.getAttribute('name')).toBe('password');
    expect(password.hasAttribute('required')).toBe(true);
  });

  it('retains the optional password and server field names while editing', () => {
    render(<InterpreterForm interpreterId={13} initialData={{ name: 'María', status: 'Activo' }} />);
    const optionalPassword = screen.getByLabelText('Cambiar Contraseña (Opcional)');
    expect(optionalPassword.getAttribute('name')).toBe('password');
    expect(optionalPassword.hasAttribute('required')).toBe(false);
    expect(screen.getByLabelText('Nombre Completo').getAttribute('name')).toBe('name');
    expect(screen.getByLabelText('Tarifa por Hora (RD$)').getAttribute('name')).toBe('hourlyTariff');
  });
});
