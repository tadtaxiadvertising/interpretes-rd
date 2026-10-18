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

import { AddCandidateButton } from '@/components/AddCandidateButton';
import { ExportCandidatesButton } from '@/components/ExportCandidatesButton';
import { CandidateActions } from '@/components/CandidateActions';

interface Candidate {
  id: number;
  name: string;
  email: string;
  telefono: string | null;
  pais: string | null;
  status: string;
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

  const statusColors: Record<string, string> = {
    'Aplicante': 'bg-blue-500/10 text-blue-400',
    'Entrevista Agendada': 'bg-purple-500/10 text-purple-400',
    'Rechazado': 'bg-red-500/10 text-red-400',
    'Contratado': 'bg-green-500/10 text-green-400',
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold text-white">Recruitment Funnel</h2>
          <p className="text-gray-400">Track and manage interpreter applications</p>
        </div>
        <div className="flex gap-4">
          <ExportCandidatesButton data={candidates as any} />
          <AddCandidateButton />
        </div>
      </header>


      {/* Pipeline Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {[
          { label: 'Total Applicants', count: candidates.length, icon: Users, color: 'text-blue-400' },
          { label: 'In Interview', count: candidates.filter((c: Candidate) => c.status === 'Entrevista Agendada').length, icon: Calendar, color: 'text-purple-400' },
          { label: 'Hired this Month', count: candidates.filter((c: Candidate) => c.status === 'Contratado').length, icon: CheckCircle2, color: 'text-green-400' },
          { label: 'Rejection Rate', count: candidates.length > 0 ? `${Math.round((candidates.filter((c: Candidate) => c.status === 'Rechazado').length / candidates.length) * 100)}%` : '0%', icon: XCircle, color: 'text-red-400' },
        ].map((stat: Stat, i: number) => (
          <div key={i} className="glass p-6 rounded-3xl border border-white/5">
            <div className="flex justify-between items-start">
              <div className={`p-3 rounded-2xl bg-white/5 ${stat.color}`}>
                <stat.icon size={20} />
              </div>
            </div>
            <div className="mt-4">
              <p className="text-sm text-gray-500 font-medium">{stat.label}</p>
              <h3 className="text-2xl font-bold text-white mt-1">{stat.count}</h3>
            </div>
          </div>
        ))}
      </div>

      {/* Candidates List */}
      <div className="glass rounded-3xl overflow-visible">
        <div className="p-6 border-b border-white/5 flex flex-wrap gap-4 items-center justify-between">
          <h3 className="text-xl font-bold text-white">Active Candidates</h3>
          <div className="flex gap-2">
             <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
              <input 
                type="text" 
                placeholder="Search candidates..." 
                className="bg-white/5 border border-white/10 rounded-xl py-2 pl-10 pr-4 text-sm text-white focus:outline-none focus:border-blue-500/50 transition-colors"
              />
            </div>
            <button className="p-2 bg-white/5 border border-white/10 rounded-xl text-gray-400 hover:text-white transition-colors">
              <Filter size={18} />
            </button>
          </div>
        </div>

        <table className="w-full text-left">
          <thead>
            <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-white/5">
              <th className="py-6 px-8">Candidate</th>
              <th className="py-6 px-4">Contact</th>
              <th className="py-6 px-4">Status</th>
              <th className="py-6 px-4">Roleplay</th>
              <th className="py-6 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {candidates.map((candidate: Candidate) => (
              <tr key={candidate.id} className="group hover:bg-white/5 transition-colors">
                <td className="py-6 px-8">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/10 to-purple-500/10 flex items-center justify-center text-blue-400 font-bold border border-white/5">
                      {candidate.name.charAt(0)}
                    </div>
                    <div>
                      <p className="font-bold text-white group-hover:text-blue-400 transition-colors">
                        {candidate.name}
                      </p>
                      <p className="text-xs text-gray-500 flex items-center gap-1 mt-1">
                        <Globe size={12} /> {candidate.pais || 'Remote'}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="py-6 px-4">
                  <div className="space-y-1">
                    <p className="text-sm text-gray-300 flex items-center gap-2">
                      <Mail size={14} className="text-gray-500" /> {candidate.email}
                    </p>
                    {candidate.telefono && (
                      <p className="text-xs text-gray-500 flex items-center gap-2">
                        <Phone size={14} className="text-gray-500" /> {candidate.telefono}
                      </p>
                    )}
                  </div>
                </td>
                <td className="py-6 px-4">
                  <div className="flex flex-col gap-1.5 items-start">
                    <span className={cn(
                      "px-3 py-1 rounded-full text-xs font-bold",
                      statusColors[candidate.status] || "bg-gray-500/10 text-gray-400"
                    )}>
                      {candidate.status}
                    </span>
                    {candidate.applicationStatus && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/5 text-gray-400 border border-white/10">
                        {candidate.applicationStatus}
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-6 px-4">
                  {candidate.resultRoleplay !== null && candidate.resultRoleplay !== undefined ? (
                    <div className="flex items-center gap-2">
                      <div className="w-12 bg-white/5 h-1.5 rounded-full overflow-hidden">
                        <div 
                          className={cn(
                            "h-full rounded-full",
                            candidate.resultRoleplay >= 80 ? "bg-green-500" :
                            candidate.resultRoleplay >= 70 ? "bg-yellow-500" : "bg-red-500"
                          )}
                          style={{ width: `${candidate.resultRoleplay}%` }}
                        />
                      </div>
                      <span className="text-sm font-bold text-white">{candidate.resultRoleplay}%</span>
                    </div>
                  ) : (
                    <span className="text-xs text-gray-600">Not Evaluated</span>
                  )}
                </td>
                <td className="py-6 px-4 text-right">
                  <CandidateActions candidate={candidate} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        {candidates.length === 0 && (
          <div className="p-20 text-center">
            <Clock size={48} className="mx-auto text-gray-700 mb-4" />
            <p className="text-gray-500">No candidates in the pipeline yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}
