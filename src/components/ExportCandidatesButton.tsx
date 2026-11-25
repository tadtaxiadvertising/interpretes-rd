'use client';

import React from 'react';
import { Download } from 'lucide-react';
import { downloadCsv } from '@/lib/download-csv';
import { candidateStatusDisplay } from '@/lib/recruitment/status-display';

interface Candidate {
  id: number;
  name: string;
  email: string;
  telefono: string | null;
  pais: string | null;
  fuente: string | null;
  englishLevel: string | null;
  speedtestMbps: number | null;
  applicationStatus: string | null;
  resultRoleplay: number | null;
  fechaPostulacion: string;
}

interface ExportCandidatesButtonProps {
  data: Candidate[];
}

export function ExportCandidatesButton({ data }: ExportCandidatesButtonProps) {
  const exportToCSV = () => {
    if (!data.length) return;

    const headers = [
      'Name',
      'Email',
      'Phone',
      'Province / legacy location',
      'Source',
      'English Level',
      'Internet Speed',
      'Status',
      'Roleplay Result',
      'Application Date'
    ];

    const csvRows = data.map(candidate => [
      `"${candidate.name}"`,
      candidate.email,
      candidate.telefono || 'N/A',
      candidate.pais || 'N/A',
      candidate.fuente || 'N/A',
      candidate.englishLevel || 'N/A',
      candidate.speedtestMbps ? `${candidate.speedtestMbps} Mbps` : 'N/A',
      candidateStatusDisplay(candidate.applicationStatus).label,
      candidate.resultRoleplay ? `${candidate.resultRoleplay}%` : 'N/A',
      new Date(candidate.fechaPostulacion).toLocaleDateString()
    ].join(','));

    const csvContent = [headers.join(','), ...csvRows].join('\n');
    downloadCsv(csvContent, `candidates_export_${new Date().toISOString().split('T')[0]}.csv`);
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
