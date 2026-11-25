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

  it('escapes interpreter text without changing signed numeric columns', () => {
    render(<ExportInterpretersButton data={[{
      id: 1, externalId: '=1+1', name: 'Ana, "María"', emailCorporativo: null,
      status: 'Activo', campaign: '  @SUM(1,2)', tariffPerMinute: -2, createdAt: '2026-01-01T12:00:00Z',
    }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    const csv = vi.mocked(downloadCsv).mock.calls[0][0];
    expect(csv).toContain("1,\"'=1+1\",\"Ana, \"\"María\"\"\",N/A,Activo,\"'@SUM(1,2)\",-2,-120.00,");
  });

  it('keeps payroll deductions and negative totals numeric', () => {
    render(<ExportPayrollButton data={[{
      id: 'test', periodStart: '2026-01-01T12:00:00Z', periodEnd: '2026-01-15T12:00:00Z',
      totalMinutes: 100, grossTotal: 200, qualityBonus: 0, penalidades: -25,
      transferDeduction: 10, netTotal: -5, status: 'Pending',
      interpreter: { name: '=1+1', emailCorporativo: null, metodoPago: 'Transferencia, local' },
    }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    const csv = vi.mocked(downloadCsv).mock.calls[0][0];
    expect(csv).toContain("\"'=1+1\",N/A,");
    expect(csv).toContain(',100,200,0,-25,10,-5,Pending,"Transferencia, local"');
  });

  it('protects candidate phone and location while keeping existing units', () => {
    render(<ExportCandidatesButton data={[{
      id: 1, name: 'Ejemplo', email: 'example@example.invalid', telefono: '+18095550123',
      pais: 'Santiago, RD', fuente: '=1+1', englishLevel: 'C1', speedtestMbps: 50,
      applicationStatus: null, resultRoleplay: 90, fechaPostulacion: '2026-01-01T12:00:00Z',
    }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    const csv = vi.mocked(downloadCsv).mock.calls[0][0];
    expect(csv).toContain("\"'+18095550123\",\"Santiago, RD\",\"'=1+1\",C1,50 Mbps,");
    expect(csv).toContain(',90%,');
  });
});
