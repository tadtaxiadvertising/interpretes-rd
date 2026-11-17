'use client';

import React from 'react';
import { Download } from 'lucide-react';
import { buildQaScoresCsv, type QAExportRow } from '@/lib/qa-csv-export';

interface ExportQAScoresButtonProps {
  data: QAExportRow[];
}

export function ExportQAScoresButton({ data }: ExportQAScoresButtonProps) {
  const exportToCSV = () => {
    if (!data.length) return;

    const csvContent = buildQaScoresCsv(data);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    try {
      link.setAttribute('href', url);
      link.setAttribute('download', `qa_scores_export_${new Date().toISOString().slice(0, 10)}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
    } finally {
      link.remove();
      // Give browsers time to complete the download before revoking the URL.
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    }
  };

  return (
    <button
      type="button"
      onClick={exportToCSV}
      disabled={!data.length}
      className="flex items-center gap-2 bg-white/5 border border-white/10 hover:bg-white/10 text-white px-6 py-3 rounded-2xl font-bold transition-all active:scale-95 disabled:opacity-50"
    >
      <Download size={20} aria-hidden="true" /> Export CSV
    </button>
  );
}
