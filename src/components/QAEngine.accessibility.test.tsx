import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/app/actions/qa.actions', () => ({
  submitQAEvaluation: vi.fn(),
}));

import { QAEngine } from './QAEngine';

afterEach(() => cleanup());

describe('QAEngine accessible input and precision contract', () => {
  it('provides associated labels and supports exactly two decimal places', () => {
    render(<QAEngine interpreters={[{ id: 7, name: 'Intérprete Prueba', externalId: 'T-7' }]} />);
    const interpreter = screen.getByLabelText('Intérprete Auditado') as HTMLSelectElement;
    expect(interpreter.name).toBe('interpreterId');
    expect(screen.getByLabelText('Production Log ID (Opcional)').getAttribute('step')).toBe('1');

    for (const name of [
      'Protocolo (20%)', 'Interpretación (40%)', 'Idioma (20%)',
      'Servicio (10%)', 'Técnico (10%)',
    ]) {
      const input = screen.getByLabelText(name) as HTMLInputElement;
      expect(input.step).toBe('0.01');
      expect(input.min).toBe('0');
      expect(input.max).toBe('100');
      expect(input.required).toBe(true);
      expect(input.readOnly).toBe(false);
    }

    expect((screen.getByLabelText('Comentarios del Auditor') as HTMLTextAreaElement).maxLength).toBe(2000);
  });

  it('locks irrelevant score inputs for critical errors but keeps them present in form', () => {
    render(<QAEngine interpreters={[]} />);
    const critical = screen.getByRole('checkbox', { name: 'Flag: Error Crítico Detectado' });
    fireEvent.click(critical);

    const score = screen.getByLabelText('Protocolo (20%)') as HTMLInputElement;
    expect(score.readOnly).toBe(true);
    expect(score.required).toBe(false);
    expect(score.name).toBe('protocolScore');
    expect(score.value).toBe('100');
    expect(screen.getByRole('button', { name: 'Registrar Auditoría Segura' })).toBeTruthy();
  });
  it('suggests only unreviewed production logs for the selected interpreter and resets stale IDs', () => {
    const { container } = render(<QAEngine
      interpreters={[
        { id: 7, name: 'Intérprete A', externalId: 'T-7' },
        { id: 8, name: 'Intérprete B', externalId: 'T-8' },
      ]}
      productionLogSuggestions={[
        { id: 22, interpreterId: 7, date: '2026-11-17', status: 'Finalizado' },
        { id: 33, interpreterId: 8, date: '2026-11-16', status: 'Manual' },
      ]}
    />);
    const interpreter = screen.getByLabelText('Intérprete Auditado') as HTMLSelectElement;
    const productionId = screen.getByLabelText('Production Log ID (Opcional)') as HTMLInputElement;
    const suggestions = () => [...container.querySelectorAll('datalist option')]
      .map(option => option.getAttribute('value'));

    expect(suggestions()).toEqual([]);
    fireEvent.change(interpreter, { target: { value: '7' } });
    expect(suggestions()).toEqual(['22']);
    fireEvent.change(productionId, { target: { value: '22' } });
    expect(productionId.value).toBe('22');

    fireEvent.change(interpreter, { target: { value: '8' } });
    expect(productionId.value).toBe('');
    expect(suggestions()).toEqual(['33']);
    expect(productionId.name).toBe('productionLogId');
  });

});
