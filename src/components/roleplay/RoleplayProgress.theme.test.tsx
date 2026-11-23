import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RoleplayProgress } from './RoleplayProgress';

afterEach(() => cleanup());

describe('Responsive Roleplay progress', () => {
  it('shows a compact phone indicator without removing the desktop steps', () => {
    const { container } = render(
      <RoleplayProgress
        currentStep={2}
        totalSteps={5}
        currentScenario={1}
        totalScenarios={4}
        stepLabels={['Inicio', 'Escuchar', 'Grabar', 'Evaluar', 'Enviar']}
        completedScenarios={[0]}
      />
    );

    const compact = screen.getByLabelText('Progreso del Roleplay');
    expect(compact.className).toContain('md:hidden');
    expect(screen.getByText('Escenario 2/4')).toBeTruthy();
    expect(screen.getByText('50% completado')).toBeTruthy();
    expect(compact.querySelector('[style*="width: 50%"]')).toBeTruthy();

    const desktop = container.querySelector('.md\\:block');
    expect(desktop).toBeTruthy();
    expect(screen.getByText('Progreso General')).toBeTruthy();
    expect(screen.getByText('Escenarios completados')).toBeTruthy();
  });

  it('reaches 100% at the final completion step', () => {
    render(<RoleplayProgress currentStep={4} totalSteps={5} currentScenario={1} totalScenarios={2}
      stepLabels={['Inicio', 'Escuchar', 'Grabar', 'Evaluar', 'Enviar']} completedScenarios={[0, 1]} />);
    expect(screen.getByText('100% completado')).toBeTruthy();
  });
});
