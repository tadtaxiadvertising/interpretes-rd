'use client';

import React from 'react';
import { Download } from 'lucide-react';
import { downloadCsv } from '@/lib/download-csv';
import { csvTextCell, csvNumberCell } from '@/lib/legacy-csv-cells';

interface PayrollRecord {
  id: string;
  periodStart: string;
  periodEnd: string;
  totalMinutes: number;
  grossTotal: number;
  qualityBonus: number;
  penalidades: number;
  transferDeduction: number;
  netTotal: number;
  status: string;
  interpreter: {
    name: string;
    emailCorporativo: string | null;
    metodoPago: string | null;
  };
}

interface ExportPayrollButtonProps {
  data: PayrollRecord[];
}

export function ExportPayrollButton({ data }: ExportPayrollButtonProps) {
  const exportToCSV = () => {
    if (!data.length) return;

    const headers = [
      'Interpreter',
      'Email',
      'Period Start',
      'Period End',
      'Total Minutes',
      'Gross Total',
      'Quality Bonus',
      'Penalties',
      'Transfer Deduction',
      'Net Total',
      'Status',
      'Payment Method'
    ];

    const csvRows = data.map(record => [
      csvTextCell(record.interpreter.name, true),
      csvTextCell(record.interpreter.emailCorporativo || 'N/A'),
      csvTextCell(new Date(record.periodStart).toLocaleDateString()),
      csvTextCell(new Date(record.periodEnd).toLocaleDateString()),
      csvNumberCell(record.totalMinutes),
      csvNumberCell(record.grossTotal),
      csvNumberCell(record.qualityBonus),
      csvNumberCell(record.penalidades),
      csvNumberCell(record.transferDeduction),
      csvNumberCell(record.netTotal),
      csvTextCell(record.status),
      csvTextCell(record.interpreter.metodoPago || 'N/A')
    ].join(','));

    const csvContent = [headers.join(','), ...csvRows].join('\n');
    downloadCsv(csvContent, `payroll_export_${new Date().toISOString().split('T')[0]}.csv`);
  };

  return (
    <button
      type="button"
      onClick={exportToCSV}
      disabled={!data.length}
      className="theme-action-secondary flex items-center justify-center gap-2 px-6 py-3 rounded-2xl font-bold transition-colors"
    >
      <Download size={20} aria-hidden="true" />
      Export CSV
    </button>
  );
}
