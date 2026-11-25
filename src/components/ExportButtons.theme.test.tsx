// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExportInterpretersButton } from './ExportInterpretersButton';
import { ExportPayrollButton } from './ExportPayrollButton';
import { ExportCandidatesButton } from './ExportCandidatesButton';
import { ExportQAScoresButton } from './ExportQAScoresButton';
import { downloadCsv } from '@/lib/download-csv';

vi.mock('@/lib/download-csv', () => ({ downloadCsv: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('shared CSV export controls', () => {
  it.each([
    ExportInterpretersButton, ExportPayrollButton, ExportCandidatesButton, ExportQAScoresButton,
  ])('uses a non-submitting secondary action and prevents empty downloads', Component => {
    render(<Component data={[]} />);
    const button = screen.getByRole('button', { name: 'Export CSV' }) as HTMLButtonElement;
    expect(button.type).toBe('button');
    expect(button.disabled).toBe(true);
    expect(button.className).toContain('theme-action-secondary');
    fireEvent.click(button);
    expect(downloadCsv).not.toHaveBeenCalled();
  });

  it('preserves the interpreter export filename, headers and hourly conversion', () => {
    render(<ExportInterpretersButton data={[{
      id: 1, externalId: 'TEST-1', name: 'Ejemplo', emailCorporativo: null,
      status: 'Activo', campaign: null, tariffPerMinute: 2, createdAt: '2026-01-01T12:00:00Z',
    }]} />);
    const button = screen.getByRole('button', { name: 'Export CSV' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(downloadCsv).toHaveBeenCalledWith(
      'ID,External ID,Name,Email,Status,Campaign,Tariff/Min,Tariff/Hour,Created At\n1,TEST-1,"Ejemplo",N/A,Activo,"N/A",2,120.00,' + new Date('2026-01-01T12:00:00Z').toLocaleDateString(),
      expect.stringMatching(/^interpreters_export_\d{4}-\d{2}-\d{2}\.csv$/),
    );
  });
});
