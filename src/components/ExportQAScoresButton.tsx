'use client';

import React from 'react';
import { Download } from 'lucide-react';
import { downloadCsv } from '@/lib/download-csv';
import { buildQaScoresCsv, type QAExportRow } from '@/lib/qa-csv-export';

interface ExportQAScoresButtonProps {
  data: QAExportRow[];
}

export function ExportQAScoresButton({ data }: ExportQAScoresButtonProps) {
  const exportToCSV = () => {
    if (!data.length) return;

    const csvContent = buildQaScoresCsv(data);
    downloadCsv(csvContent, `qa_scores_export_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  return (
    <button
      type="button"
      onClick={exportToCSV}
      disabled={!data.length}
      className="theme-action-secondary flex items-center justify-center gap-2 px-6 py-3 rounded-2xl font-bold transition-colors"
    >
      <Download size={20} aria-hidden="true" /> Export CSV
    </button>
  );
}
