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

  // QA is linked to ProductionLog, not CallSession. Suggest only genuinely
  // unreviewed production logs with an owner; never imply recent calls are
  // unreviewed. This is a bounded convenience list, not a historical audit.
  const unreviewedProduction = await prisma.productionLog.findMany({
    where: { interpreterId: { not: null }, qaScore: { is: null } },
    select: { id: true, interpreterId: true, date: true, status: true },
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
    take: 100,
  });
  const productionLogSuggestions = unreviewedProduction.flatMap(log =>
    log.interpreterId === null ? [] : [{
      id: log.id,
      interpreterId: log.interpreterId,
      date: log.date.toISOString().slice(0, 10),
      status: log.status,
    }],
  );

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header>
        <h2 className="text-3xl font-bold text-[var(--foreground)] tracking-tight">Auditoría de Calidad</h2>
        <p className="text-[var(--text-secondary)] mt-1 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          Quality Assurance Engine • Reglas de Penalización Activas
        </p>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        <div className="xl:col-span-2">
          <QAEngine interpreters={interpreters} productionLogSuggestions={productionLogSuggestions} />
        </div>

        <div className="space-y-6">
          <div className="glass p-6 rounded-3xl border border-[var(--border)] bg-[var(--theme-panel)]">
            <h3 className="text-xl font-bold text-[var(--foreground)] mb-6 flex items-center gap-2">
              <CheckCircle2 className="text-[var(--theme-success)]" />
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
                        display.severity === 'unscored' ? "bg-[var(--theme-surface-muted)] border-[var(--border)]" :
                        "bg-orange-500/5 border-orange-500/20"
                  )}>
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-bold text-[var(--foreground)] leading-none">{score.interpreter?.name || 'Desconocido'}</p>
                        <p className="text-xs text-[var(--text-tertiary)] mt-1">{score.auditor}</p>
                      </div>
                      <span className={cn(
                        "px-3 py-1 rounded-lg text-xs font-black uppercase border",
                        needsAttention ? 'bg-red-500/10 text-[var(--theme-danger)] border-red-500/20' :
                          isExcellent ? 'bg-green-500/10 text-[var(--theme-success)] border-green-500/20' :
                            display.severity === 'unscored' ? 'bg-[var(--theme-surface-muted)] text-[var(--text-secondary)] border-[var(--border)]' :
                            'bg-orange-500/10 text-[var(--theme-away)] border-orange-500/20'
                      )}>
                        {display.scoreLabel}
                      </span>
                    </div>
                    <div className="mt-3 pt-3 border-t border-[var(--border)] flex justify-between items-center">
                      <p className="text-[10px] text-[var(--text-tertiary)] font-mono tracking-wider">
                        QA-{score.id} • {new Date(score.auditDate).toLocaleDateString()}
                      </p>
                      <p className="text-[10px] font-bold uppercase text-[var(--text-secondary)]">
                        {display.criticalLabel ? (
                          <span className="text-[var(--theme-danger)]">{display.criticalLabel} · </span>
                        ) : null}
                        {score.accionRequerida ?? 'Sin acción definida'}
                      </p>
                    </div>
                  </div>
                )
              })}
              {recentScores.length === 0 && (
                <div className="p-8 text-center border-2 border-dashed border-[var(--border)] rounded-2xl">
                  <p className="text-[var(--text-tertiary)] text-sm">No hay auditorías registradas en el sistema.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
