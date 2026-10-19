import React from 'react';
import { Mic2, Loader2, Filter, Search, Play, Clock, CheckCircle2, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import prisma from '@/lib/prisma';
import { SessionActions } from '@/components/admin/SessionActions';
import { cn, formatDate } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// Read straight from Prisma: a server component must not self-fetch the
// internal REST API (cookies are not forwarded, so the admin guard would
// answer 403 and the list would silently render empty).
async function getRoleplays() {
  try {
    return await prisma.roleplaySession.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        interpreter: { select: { id: true, name: true, externalId: true, emailCorporativo: true } },
        recruitmentCandidate: { select: { id: true, name: true, email: true } },
        qaScore: { select: { id: true, totalScore: true, criticalError: true } },
      },
    });
  } catch {
    return [];
  }
}

export default async function AdminRoleplaysPage() {
  const roleplays = await getRoleplays();

  const statusColors: Record<string, string> = {
    DRAFT: 'bg-slate-500/10 text-slate-400',
    INVITED: 'bg-amber-500/10 text-amber-400',
    STARTED: 'bg-blue-500/10 text-blue-400',
    IN_PROGRESS: 'bg-blue-500/10 text-blue-400',
    SUBMITTED: 'bg-yellow-500/10 text-yellow-400',
    UNDER_REVIEW: 'bg-blue-500/10 text-blue-400',
    EVALUATED: 'bg-green-500/10 text-green-400',
    PASSED: 'bg-emerald-500/10 text-emerald-400',
    FAILED: 'bg-red-500/10 text-red-400',
    EXPIRED: 'bg-slate-500/10 text-slate-400',
    CANCELLED: 'bg-slate-500/10 text-slate-400',
  };

  const participantTypeColors: Record<string, string> = {
    interpreter: 'bg-blue-500/10 text-blue-400',
    candidate: 'bg-purple-500/10 text-purple-400',
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold text-white">Roleplay Sessions</h2>
          <p className="text-gray-400">Manage roleplay sessions and evaluations</p>
        </div>
        <Link href="/admin/roleplays/new" className="px-6 py-3 bg-red-600 hover:bg-red-500 text-white rounded-2xl font-bold flex items-center gap-2 transition-colors">
          <Mic2 size={20} />
          Create Roleplay
        </Link>
      </header>

      <div className="glass rounded-3xl overflow-visible">
        <div className="p-6 border-b border-white/5 flex flex-wrap gap-4 items-center justify-between">
          <h3 className="text-xl font-bold text-white">All Sessions ({roleplays.length})</h3>
          <div className="flex gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
              <input 
                type="text" 
                placeholder="Search sessions..." 
                className="bg-white/5 border border-white/10 rounded-xl py-2 pl-10 pr-4 text-sm text-white focus:outline-none focus:border-blue-500/50 transition-colors"
              />
            </div>
            <button className="p-2 bg-white/5 border border-white/10 rounded-xl text-gray-400 hover:text-white transition-colors">
              <Filter size={18} />
            </button>
          </div>
        </div>

        {roleplays.length === 0 ? (
          <div className="p-20 text-center">
            <Mic2 size={48} className="mx-auto text-gray-700 mb-4" />
            <p className="text-gray-500">No roleplay sessions yet.</p>
            <Link href="/admin/roleplays/new" className="mt-4 inline-flex items-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold transition-colors">
              <Mic2 size={18} />
              Create First Roleplay
            </Link>
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-white/5">
                <th className="py-6 px-8">Session</th>
                <th className="py-6 px-4">Participant</th>
                <th className="py-6 px-4">Type</th>
                <th className="py-6 px-4">Status</th>
                <th className="py-6 px-4">Created</th>
                <th className="py-6 px-4">QA Score</th>
                <th className="py-6 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {roleplays.map((session: any) => (
                <tr key={session.id} className="group hover:bg-white/5 transition-colors">
                  <td className="py-6 px-8">
                    <div className="font-mono text-sm text-gray-400">{session.id.slice(0, 12)}...</div>
                    <div className="text-xs text-gray-500 mt-1">{formatDate(session.createdAt)}</div>
                  </td>
                  <td className="py-6 px-4">
                    <div>
                      <p className="font-bold text-white">{session.interpreter?.name || session.recruitmentCandidate?.name || 'Unknown'}</p>
                      <p className="text-xs text-gray-500">{session.interpreter?.emailCorporativo || session.recruitmentCandidate?.email}</p>
                    </div>
                  </td>
                  <td className="py-6 px-4">
                    <span className={cn(
                      "px-3 py-1 rounded-full text-xs font-bold",
                      participantTypeColors[session.interpreter ? 'interpreter' : 'candidate']
                    )}>
                      {session.interpreter ? 'Interpreter' : 'Candidate'}
                    </span>
                  </td>
                  <td className="py-6 px-4">
                    <span className={cn(
                      "px-3 py-1 rounded-full text-xs font-bold",
                      statusColors[session.status]
                    )}>
                      {session.status}
                    </span>
                  </td>
                  <td className="py-6 px-4 text-sm text-gray-300">
                    {formatDate(session.createdAt)}
                  </td>
                  <td className="py-6 px-4">
                    {session.qaScore ? (
                      <div className="flex items-center gap-2">
                        <div className="w-16 bg-white/5 h-1.5 rounded-full overflow-hidden">
                          <div 
                            className={cn(
                              "h-full rounded-full",
                              session.qaScore.criticalError ? "bg-red-500" :
                              (session.qaScore.totalScore || 0) >= 80 ? "bg-green-500" :
                              (session.qaScore.totalScore || 0) >= 70 ? "bg-yellow-500" : "bg-red-500"
                            )}
                            style={{ width: `${session.qaScore.totalScore || 0}%` }}
                          />
                        </div>
                        <span className="text-sm font-bold text-white">
                          {session.qaScore.criticalError ? '0 (Critical)' : `${session.qaScore.totalScore}%`}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-600">Not Evaluated</span>
                    )}
                  </td>
                  <td className="py-6 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/admin/roleplays/${session.id}`}
                        className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-xl font-medium transition-colors border border-white/10 text-sm"
                      >
                        Ver evaluación
                      </Link>
                      <SessionActions sessionId={session.id} status={session.status} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}