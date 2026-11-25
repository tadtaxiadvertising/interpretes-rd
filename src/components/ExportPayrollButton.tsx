'use client';

import React from 'react';
import { Download } from 'lucide-react';
import { downloadCsv } from '@/lib/download-csv';

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
      `"${record.interpreter.name}"`,
      record.interpreter.emailCorporativo || 'N/A',
      new Date(record.periodStart).toLocaleDateString(),
      new Date(record.periodEnd).toLocaleDateString(),
      record.totalMinutes,
      record.grossTotal,
      record.qualityBonus,
      record.penalidades,
      record.transferDeduction,
      record.netTotal,
      record.status,
      record.interpreter.metodoPago || 'N/A'
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
