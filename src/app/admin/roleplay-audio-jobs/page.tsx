import React from 'react';
import Link from 'next/link';
import { RequeueButton } from './RequeueButton';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-500/10 text-yellow-400',
  PROCESSING: 'bg-blue-500/10 text-blue-400',
  COMPLETED: 'bg-green-500/10 text-green-400',
  FAILED: 'bg-red-500/10 text-red-400',
};

export default async function AdminRoleplayAudioJobsPage() {
  const jobs = await prisma.roleplayAudioJob.findMany({
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 100,
    include: {
      session: { select: { id: true, status: true, interpreterId: true, recruitmentCandidateId: true } },
      scenario: { select: { id: true, title: true, order: true } },
    },
  });

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-white">Cola de audio Roleplay</h2>
          <p className="text-gray-400">Jobs de conversión de audio (máx. 100 recientes)</p>
        </div>
        <Link
          href="/admin/roleplays/queue"
          className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-xl font-medium transition-colors border border-white/10"
        >
          Volver a cola QA
        </Link>
      </header>

      <div className="glass rounded-3xl overflow-hidden">
        {jobs.length === 0 ? (
          <div className="p-20 text-center text-gray-500">No hay jobs de audio.</div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-white/5">
                <th className="py-4 px-6">Job</th>
                <th className="py-4 px-4">Estado</th>
                <th className="py-4 px-4">Intentos</th>
                <th className="py-4 px-4">Escenario</th>
                <th className="py-4 px-4">Sesión</th>
                <th className="py-4 px-4">Último error</th>
                <th className="py-4 px-4 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {jobs.map((job) => (
                <tr key={job.id} className="hover:bg-white/5 transition-colors">
                  <td className="py-4 px-6 font-mono text-xs text-gray-400">{job.id.slice(0, 12)}…</td>
                  <td className="py-4 px-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${STATUS_COLORS[job.status] ?? 'bg-slate-500/10 text-slate-400'}`}>
                      {job.status}
                    </span>
                  </td>
                  <td className="py-4 px-4 text-sm text-gray-300">{job.attempts}/{job.maxAttempts}</td>
                  <td className="py-4 px-4 text-sm text-gray-300">{job.scenario.title} (#{job.scenario.order})</td>
                  <td className="py-4 px-4 font-mono text-xs text-gray-400">{job.session.id.slice(0, 12)}…</td>
                  <td className="py-4 px-4 text-xs text-red-300 max-w-xs truncate" title={job.lastError ?? ''}>
                    {job.lastError ?? '—'}
                  </td>
                  <td className="py-4 px-4 text-right">
                    {job.status === 'FAILED' ? <RequeueButton jobId={job.id} /> : '—'}
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
