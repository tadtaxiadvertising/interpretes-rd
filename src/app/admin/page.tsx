import React from 'react';
import { getCurrentProfile } from '@/app/actions/auth';
import { redirect } from 'next/navigation';
import {
  Users, Phone, Activity, AlertTriangle, CheckCircle2, Wifi
} from 'lucide-react';
import { cn } from '@/lib/utils';
import prismaClient from '@/lib/prisma';
import LiveRosterPanel from '@/components/admin/LiveRosterPanel';
import { GlobalGoalsButton } from '@/components/GlobalGoalsButton';
import { getSystemConfig } from '@/app/actions/settings';
import { getMonthBounds } from '@/lib/interpreter-metrics';

export const revalidate = 120;

const prisma = prismaClient;

type PageProps = {
  params: Promise<{ [key: string]: string | string[] | undefined }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function AdminDashboard(props: PageProps) {
  await props.params;
  await props.searchParams;

  const profile = await getCurrentProfile();

  // Fail closed: a missing or unresolved profile must never be treated as an
  // administrator merely because the session cookie is present.
  if (!profile) {
    redirect('/login');
  }

  if (profile.role !== 'admin') {
    redirect('/dashboard');
  }

  const { startOfMonth: monthStart } = getMonthBounds();

  let interpreters: any[] = [];
  let activeCalls: any[] = [];
  let monthProductionLogs: any[] = [];
  let qaAlertsCount = 0;

  try {
    [interpreters, activeCalls, monthProductionLogs, qaAlertsCount] = await Promise.all([
      prisma.interpreter.findMany({
        select: {
          id: true,
          externalId: true,
          name: true,
          realtimeStatus: true,
          updatedAt: true,
        }
      }),
      prisma.callSession.findMany({
        where: { endedAt: null },
        select: { id: true }
      }),
      prisma.productionLog.findMany({
        where: { date: { gte: monthStart } },
        select: { interpretedMinutes: true, adherence: true }
      }),
      prisma.qAScore.count({
        where: {
          auditDate: { gte: monthStart },
          totalScore: { lt: 80 }
        }
      })
    ]);
  } catch (error) {
    console.error('❌ ADMIN: Database fetch failed:', error);
  }

  const totalMinutesMonth = monthProductionLogs.reduce((sum, log) => sum + (log.interpretedMinutes || 0), 0);

  const validAdherenceLogs = monthProductionLogs.filter(log => log.adherence && Number(log.adherence) > 0);
  const avgAdherence = validAdherenceLogs.length > 0
    ? validAdherenceLogs.reduce((sum, log) => sum + Number(log.adherence), 0) / validAdherenceLogs.length
    : 0;

  const globalGoalHours = parseFloat(await getSystemConfig('standard_monthly_goal_hours', '120'));

  const STALE_THRESHOLD = 2 * 60 * 1000;
  const nowTime = new Date().getTime();

  const onlineCount = interpreters.filter((i: any) =>
    i.realtimeStatus === 'Online' &&
    (nowTime - new Date(i.updatedAt).getTime() < STALE_THRESHOLD)
  ).length;

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <header className="flex justify-between items-start">
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tight">Telemetría Central</h2>
          <p className="text-gray-400 mt-1 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Dashboard Administrador · Caching ISR (120s)
          </p>
        </div>
        <div className="flex gap-3">
          <GlobalGoalsButton initialGoal={globalGoalHours} />
        </div>
      </header>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'Intérpretes Activos', value: interpreters.length, sub: `${onlineCount} Online Now`, icon: Users, color: 'text-purple-400' },
          { label: 'Minutos Mensuales', value: totalMinutesMonth.toLocaleString(), sub: `MTD Production`, icon: Activity, color: 'text-blue-400' },
          { label: 'Tasa de Adherencia', value: `${avgAdherence.toFixed(1)}%`, sub: 'Promedio Global', icon: CheckCircle2, color: 'text-green-400' },
          { label: 'Alertas de QA (<80%)', value: qaAlertsCount, sub: 'Evaluaciones críticas', icon: AlertTriangle, color: 'text-red-400' },
        ].map((stat, i) => (
          <div key={i} className="glass p-6 rounded-3xl border border-white/5 relative overflow-hidden group flex flex-col justify-between min-h-[160px]">
            <div className="absolute -right-4 -top-4 opacity-5 group-hover:opacity-10 transition-opacity">
              <stat.icon size={80} />
            </div>
            <div className={cn("p-3 rounded-2xl bg-white/5 w-fit mb-2", stat.color)}>
              <stat.icon size={24} />
            </div>
            <div>
              <p className="text-sm text-gray-500 font-medium">{stat.label}</p>
              <h3 className="text-3xl font-bold text-white mt-1 leading-none">{stat.value}</h3>
            </div>
            <div className="mt-2 pt-2 border-t border-white/5">
              <p className="text-xs text-gray-400 flex items-center gap-1">
                {stat.sub}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* CENTERED: Intérpretes en Vivo preview (no sidebar) */}
      <LiveRosterPanel />

      {/* Empty column removed — no more sidebar grid */}
    </div>
  );
}