import React from 'react';
import { 
  Users, 
  Search, 
  Filter, 
  Mail,
  Phone,
  Globe,
  Calendar,
  CheckCircle2,
  XCircle,
  Clock
} from 'lucide-react';
import prisma from '@/lib/prisma';
import { cn } from '@/lib/utils';
import {
  candidateStatusDisplay,
  isHired,
  isInInterview,
  isRejected,
  statusToneClass,
} from '@/lib/recruitment/status-display';

import { AddCandidateButton } from '@/components/AddCandidateButton';
import { ExportCandidatesButton } from '@/components/ExportCandidatesButton';
import { CandidateActions } from '@/components/CandidateActions';

interface Candidate {
  id: number;
  name: string;
  email: string;
  telefono: string | null;
  pais: string | null;
  englishLevel: string | null;
  speedtestMbps: number | null;
  notas: string | null;
  resultRoleplay: number | null;
  applicationStatus: string | null;
}

interface Stat {
  label: string;
  count: number | string;
  icon: React.ElementType;
  color: string;
}

export const dynamic = 'force-dynamic';

async function getCandidates(): Promise<Candidate[]> {
  try {
    const candidates = await prisma.recruitmentCandidate.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        applications: { select: { status: true }, take: 1, orderBy: { createdAt: 'desc' as const } },
      },
    });
    return candidates.map((candidate) => {
      const { applications, ...rest } = candidate;
      return {
        ...(rest as Omit<Candidate, 'applicationStatus'>),
        applicationStatus: applications[0]?.status ?? null,
      };
    });
  } catch (error) {
    console.error('Error fetching candidates from DB:', error);
    return [];
  }
}

export default async function RecruitmentPage() {
  const candidates: Candidate[] = await getCandidates();

  const inInterviewCount = candidates.filter((c) => isInInterview(c.applicationStatus)).length;
  const hiredCount = candidates.filter((c) => isHired(c.applicationStatus)).length;
  const rejectedCount = candidates.filter((c) => isRejected(c.applicationStatus)).length;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header className="flex flex-wrap justify-between items-center gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-[var(--foreground)]">Gestión de postulaciones</h2>
          <p className="text-[var(--text-secondary)]">Consulta y administra las postulaciones y sus etapas de selección.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <ExportCandidatesButton data={candidates as any} />
          <AddCandidateButton />
        </div>
      </header>


      {/* Pipeline Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {[
          { label: 'Postulaciones recibidas', count: candidates.length, icon: Users, color: 'text-[var(--theme-link)]' },
          { label: 'En evaluación', count: inInterviewCount, icon: Calendar, color: 'text-[var(--theme-purple)]' },
          { label: 'Incorporaciones del mes', count: hiredCount, icon: CheckCircle2, color: 'text-[var(--theme-success)]' },
          { label: 'Tasa de no selección', count: candidates.length > 0 ? `${Math.round((rejectedCount / candidates.length) * 100)}%` : '0%', icon: XCircle, color: 'text-[var(--theme-danger)]' },
        ].map((stat: Stat, i: number) => (
          <div key={i} className="glass p-6 rounded-3xl border border-[var(--border)]">
            <div className="flex justify-between items-start">
              <div className={`p-3 rounded-2xl bg-[var(--theme-surface-muted)] ${stat.color}`}>
                <stat.icon size={20} />
              </div>
            </div>
            <div className="mt-4">
              <p className="text-sm text-[var(--text-tertiary)] font-medium">{stat.label}</p>
              <h3 className="text-2xl font-bold text-[var(--foreground)] mt-1">{stat.count}</h3>
            </div>
          </div>
        ))}
      </div>

      {/* Candidates List */}
      <div className="glass rounded-3xl overflow-visible">
        <div className="p-6 border-b border-[var(--border)] flex flex-wrap gap-4 items-center justify-between">
          <h3 className="text-xl font-bold text-[var(--foreground)]">Candidatos en proceso</h3>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
             <div className="relative min-w-0 flex-1 sm:flex-none">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={16} />
              <input 
                type="text" 
                aria-label="Buscar candidatos"
                placeholder="Buscar candidatos..." 
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--theme-panel)] py-2 pl-10 pr-4 text-sm text-[var(--foreground)] placeholder:text-[var(--text-secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 transition-colors"
              />
            </div>
            <button className="rounded-xl border border-[var(--border)] bg-[var(--theme-panel)] p-2 text-[var(--text-secondary)] hover:bg-[var(--theme-hover)] hover:text-[var(--foreground)] transition-colors">
              <Filter size={18} />
            </button>
          </div>
        </div>

        <div role="region" aria-label="Tabla de candidatos" tabIndex={0} className="max-w-full overflow-x-auto">
          <table className="w-full min-w-[850px] text-left">
          <thead className="bg-[var(--theme-surface-muted)]">
            <tr className="text-[var(--text-tertiary)] text-xs uppercase tracking-wider border-b border-[var(--border)]">
              <th className="py-6 px-8">Candidato</th>
              <th className="py-6 px-4">Contacto</th>
              <th className="py-6 px-4">Estado</th>
              <th className="py-6 px-4">Simulación</th>
              <th className="py-6 px-4 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {candidates.map((candidate: Candidate) => {
              const display = candidateStatusDisplay(candidate.applicationStatus);
              return (
              <tr key={candidate.id} className="group hover:bg-[var(--theme-hover)] transition-colors">
                <td className="py-6 px-8">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/10 to-purple-500/10 flex items-center justify-center text-[var(--theme-link)] font-bold border border-[var(--border)]">
                      {candidate.name.charAt(0)}
                    </div>
                    <div>
                      <p className="font-bold text-[var(--foreground)] group-hover:text-[var(--theme-link)] transition-colors">
                        {candidate.name}
                      </p>
                      <p className="text-xs text-[var(--text-tertiary)] flex items-center gap-1 mt-1">
                        <Globe size={12} /> {candidate.pais || 'Remoto'}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="py-6 px-4">
                  <div className="space-y-1">
                    <p className="text-sm text-[var(--text-secondary)] flex items-center gap-2">
                      <Mail size={14} className="text-[var(--text-tertiary)]" /> {candidate.email}
                    </p>
                    {candidate.telefono && (
                      <p className="text-xs text-[var(--text-tertiary)] flex items-center gap-2">
                        <Phone size={14} className="text-[var(--text-tertiary)]" /> {candidate.telefono}
                      </p>
                    )}
                  </div>
                </td>
                <td className="py-6 px-4">
                  <span className={cn(
                    "px-3 py-1 rounded-full text-xs font-bold",
                    statusToneClass(display.tone)
                  )}>
                    {display.label}
                  </span>
                </td>
                <td className="py-6 px-4">
                  {candidate.resultRoleplay !== null && candidate.resultRoleplay !== undefined ? (
                    <div className="flex items-center gap-2">
                      <div className="w-12 bg-[var(--theme-track)] h-1.5 rounded-full overflow-hidden">
                        <div 
                          className={cn(
                            "h-full rounded-full",
                            candidate.resultRoleplay >= 80 ? "bg-[var(--theme-success)]" :
                            candidate.resultRoleplay >= 70 ? "bg-[var(--theme-warning)]" : "bg-[var(--theme-danger)]"
                          )}
                          style={{ width: `${candidate.resultRoleplay}%` }}
                        />
                      </div>
                      <span className="text-sm font-bold text-[var(--foreground)]">{candidate.resultRoleplay}%</span>
                    </div>
                  ) : (
                    <span className="text-xs text-[var(--text-tertiary)]">Pendiente de evaluación</span>
                  )}
                </td>
                <td className="py-6 px-4 text-right">
                  <CandidateActions candidate={candidate} />
                </td>
              </tr>
              );
            })}
          </tbody>
          </table>
        </div>

        {candidates.length === 0 && (
          <div className="p-6 sm:p-20 text-center">
            <Clock size={48} className="mx-auto text-[var(--text-tertiary)] mb-4" />
            <p className="text-[var(--text-tertiary)]">Todavía no hay candidatos en el proceso de selección.</p>
          </div>
        )}
      </div>
    </div>
  );
}
