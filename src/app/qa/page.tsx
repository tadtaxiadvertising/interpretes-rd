import React from 'react';
import { getCurrentProfile } from '@/app/actions/auth';
import { redirect } from 'next/navigation';
import prismaClient from '@/lib/prisma';
import { QAEngine } from '@/components/QAEngine';
import { ShieldAlert, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { qaRecentScoreDisplay } from '@/lib/qa-recent-score-display';

export const dynamic = 'force-dynamic';
const prisma = prismaClient; // Regla 4: Single prisma client

type PageProps = {
  params: Promise<{ [key: string]: string | string[] | undefined }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function QAPage(props: PageProps) {
  // Desempaquetado asíncrono mandatario en Next 15
  await props.params;
  await props.searchParams;

  // getCurrentProfile resolves Supabase and Auth.js identities consistently.
  // Do not require an Auth.js session when a verified Supabase administrator
  // is already authenticated. Still fail closed for anonymous/non-admin users.
  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');
  if (profile.role !== 'admin') redirect('/dashboard');

  const interpreters = await prisma.interpreter.findMany({
    select: { id: true, name: true, externalId: true },
    orderBy: { name: 'asc' }
  });

  const recentScores = await prisma.qAScore.findMany({
    take: 6,
    orderBy: { auditDate: 'desc' },
    include: { interpreter: { select: { name: true } } }
  });

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header>
        <h2 className="text-3xl font-bold text-white tracking-tight">Auditoría de Calidad</h2>
        <p className="text-gray-400 mt-1 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          Quality Assurance Engine • Reglas de Penalización Activas
        </p>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        <div className="xl:col-span-2">
          <QAEngine interpreters={interpreters} />
        </div>

        <div className="space-y-6">
          <div className="glass p-6 rounded-3xl border border-white/5 bg-slate-900/40">
            <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
              <CheckCircle2 className="text-green-400" />
              Últimas Auditorías
            </h3>

            <div className="space-y-4">
              {recentScores.map(score => {
                const display = qaRecentScoreDisplay(score.totalScore, score.criticalError);
                const needsAttention = display.severity === 'critical' || display.severity === 'low';
                const isExcellent = display.severity === 'excellent';

                return (
                  <div key={score.id} className={cn(
                    "p-4 rounded-2xl border transition-all",
                    needsAttention ? "bg-red-500/5 border-red-500/20" :
                      isExcellent ? "bg-green-500/5 border-green-500/20" :
                        display.severity === 'unscored' ? "bg-white/5 border-white/10" :
                        "bg-orange-500/5 border-orange-500/20"
                  )}>
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-bold text-white leading-none">{score.interpreter?.name || 'Desconocido'}</p>
                        <p className="text-xs text-gray-500 mt-1">{score.auditor}</p>
                      </div>
                      <span className={cn(
                        "px-3 py-1 rounded-lg text-xs font-black uppercase border",
                        needsAttention ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                          isExcellent ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                            display.severity === 'unscored' ? 'bg-white/5 text-gray-300 border-white/10' :
                            'bg-orange-500/10 text-orange-400 border-orange-500/20'
                      )}>
                        {display.scoreLabel}
                      </span>
                    </div>
                    <div className="mt-3 pt-3 border-t border-white/5 flex justify-between items-center">
                      <p className="text-[10px] text-gray-500 font-mono tracking-wider">
                        QA-{score.id} • {new Date(score.auditDate).toLocaleDateString()}
                      </p>
                      <p className="text-[10px] font-bold uppercase text-gray-400">
                        {display.criticalLabel ? (
                          <span className="text-red-400">{display.criticalLabel} · </span>
                        ) : null}
                        {score.accionRequerida ?? 'Sin acción definida'}
                      </p>
                    </div>
                  </div>
                )
              })}
              {recentScores.length === 0 && (
                <div className="p-8 text-center border-2 border-dashed border-white/10 rounded-2xl">
                  <p className="text-gray-500 text-sm">No hay auditorías registradas en el sistema.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
