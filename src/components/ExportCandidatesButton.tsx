'use client';

import React from 'react';
import { Download } from 'lucide-react';
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
  status: string;
  applicationStatus?: string | null;
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
      'Country',
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
      candidateStatusDisplay(candidate.applicationStatus, candidate.status).label,
      candidate.resultRoleplay ? `${candidate.resultRoleplay}%` : 'N/A',
      new Date(candidate.fechaPostulacion).toLocaleDateString()
    ].join(','));

    const csvContent = [headers.join(','), ...csvRows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    
    link.setAttribute('href', url);
    link.setAttribute('download', `candidates_export_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <button 
      onClick={exportToCSV}
      disabled={!data.length}
      className="flex items-center gap-2 px-6 py-3 bg-white/5 border border-white/10 rounded-2xl text-gray-300 hover:bg-white/10 transition-all font-bold disabled:opacity-50 active:scale-95"
    >
      <Download size={20} />
      Export CSV
    </button>
  );
}
