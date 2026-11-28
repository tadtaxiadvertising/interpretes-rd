// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StudioProductionPanel from './StudioProductionPanel';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) =>
    <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/lib/roleplay-studio/production-tracking', () => ({
  productionStatus: (key: string) =>
    ['created', 'unconfirmed', 'transferred', 'verified'].includes(key) ? key : undefined,
}));
afterEach(cleanup);

const parts = Array.from({ length: 6 }, (_, index) => ({
  key: String(index + 1), number: index + 1, first: index * 10 + 1, last: index * 10 + 10,
}));
function setup(overrides: Partial<ComponentProps<typeof StudioProductionPanel>> = {}) {
  const props: ComponentProps<typeof StudioProductionPanel> = {
    parts,
    activeProductionKeys: new Map([['1', 'created'], ['2', 'unconfirmed'], ['3', 'transferred'], ['4', 'verified'], ['6', 'new']]),
    preparedPartKey: null,
    localOnly: true,
    disabled: false,
    onSelectPart: vi.fn(),
    onConfirmNavigation: vi.fn(() => false),
    ...overrides,
  };
  return { props, ...render(<StudioProductionPanel {...props}/>) };
}

describe('production package guidance', () => {
  it('recommends only a known, untouched package, never an unknown or attempted one', () => {
    const { props } = setup();
    const summary = screen.getByRole('status', { name: 'Resumen de producción' });
    expect(summary.textContent).toContain('5 de 6 partes con seguimiento');
    expect(summary.textContent).toContain('1 pendientes · 0 preparados · 1 transferidos · 1 verificados · 1 con creación confirmada · 1 sin confirmar.');
    expect(screen.getByText(/1 parte sin seguimiento disponible/)).toBeTruthy();
    expect(screen.getByText('Creación confirmada')).toBeTruthy();
    expect(screen.getByText('Intento sin confirmar')).toBeTruthy();
    expect(screen.getByText('Transferido')).toBeTruthy();
    expect(screen.getByText('Importado y verificado')).toBeTruthy();
    expect(screen.getByText(/Consulta las sesiones existentes antes de repetir una parte/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Seleccionar parte 5' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Elegir siguiente parte pendiente (6)' }));
    expect(props.onSelectPart).toHaveBeenCalledExactlyOnceWith('6');
  });
  it.each(['6', '1', '2', '5'])('does not recommend another part while package %s is prepared', preparedPartKey => {
    setup({ preparedPartKey });
    expect(screen.queryByRole('button', { name: /Elegir siguiente parte pendiente/ })).toBeNull();
    expect(screen.getByText(/Hay un paquete preparado/)).toBeTruthy();
    if (preparedPartKey === '6') {
      expect(screen.getByText('Preparado')).toBeTruthy();
      expect(screen.getByRole('status', { name: 'Resumen de producción' }).textContent).toContain('0 pendientes · 1 preparados');
    }
    if (preparedPartKey === '1') expect(screen.getByText('Creación confirmada')).toBeTruthy();
    if (preparedPartKey === '2') expect(screen.getByText('Intento sin confirmar')).toBeTruthy();
    if (preparedPartKey === '1' || preparedPartKey === '2') expect(screen.getByText('Nuevo paquete preparado')).toBeTruthy();
  });
  it.each([['3', '0 transferidos · 1 verificados'], ['4', '1 transferidos · 0 verificados']])('counts a newly prepared transient part %s only once', (preparedPartKey, counts) => {
    setup({ preparedPartKey });
    const summary = screen.getByRole('status', { name: 'Resumen de producción' });
    expect(summary.textContent).toContain('1 preparados · ' + counts);
    expect(screen.getByText('Preparado')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Elegir siguiente parte pendiente/ })).toBeNull();
  });
  it('allows deliberate manual selection while preserving guarded navigation', () => {
    const { props } = setup({ preparedPartKey: '6' });
    fireEvent.click(screen.getByRole('button', { name: 'Seleccionar parte 2' }));
    expect(props.onSelectPart).toHaveBeenCalledExactlyOnceWith('2');
    expect(fireEvent.click(screen.getByRole('link', { name: 'Consultar sesiones existentes' }))).toBe(false);
    expect(props.onConfirmNavigation).toHaveBeenCalledOnce();
  });
  it('keeps selection disabled during an operation', () => {
    const { props } = setup({ disabled: true });
    const region = within(screen.getByRole('region', { name: 'Seguimiento de producción' }));
    for (const button of region.getAllByRole('button')) {
      expect(button).toHaveProperty('disabled', true);
      fireEvent.click(button);
    }
    expect(props.onSelectPart).not.toHaveBeenCalled();
  });
  it('does not offer local part selection in server mode', () => {
    setup({ localOnly: false });
    expect(screen.queryByRole('button')).toBeNull();
  });
});
