'use client';

import React from 'react';
import { Download } from 'lucide-react';
import { downloadCsv } from '@/lib/download-csv';
import { csvTextCell, csvNumberCell } from '@/lib/legacy-csv-cells';

interface Interpreter {
  id: number;
  externalId: string;
  name: string;
  emailCorporativo: string | null;
  status: string;
  campaign: string | null;
  tariffPerMinute: number;
  createdAt: string | Date;
}

interface ExportInterpretersButtonProps {
  data: Interpreter[];
}

export function ExportInterpretersButton({ data }: ExportInterpretersButtonProps) {
  const exportToCSV = () => {
    if (!data.length) return;

    const headers = [
      'ID',
      'External ID',
      'Name',
      'Email',
      'Status',
      'Campaign',
      'Tariff/Min',
      'Tariff/Hour',
      'Created At'
    ];

    const csvRows = data.map(interpreter => [
      csvNumberCell(interpreter.id),
      csvTextCell(interpreter.externalId),
      csvTextCell(interpreter.name, true),
      csvTextCell(interpreter.emailCorporativo || 'N/A'),
      csvTextCell(interpreter.status),
      csvTextCell(interpreter.campaign || 'N/A', true),
      csvNumberCell(interpreter.tariffPerMinute),
      csvNumberCell((parseFloat(interpreter.tariffPerMinute.toString()) * 60).toFixed(2)),
      csvTextCell(new Date(interpreter.createdAt).toLocaleDateString())
    ].join(','));

    const csvContent = [headers.join(','), ...csvRows].join('\n');
    downloadCsv(csvContent, `interpreters_export_${new Date().toISOString().split('T')[0]}.csv`);
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
