import React from 'react';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Phone, Clock, DollarSign, TrendingUp, ShieldCheck, RefreshCw, LogIn, Plus, Trophy } from 'lucide-react';
import { getSystemConfig } from '@/app/actions/settings';
import { cn } from '@/lib/utils';
import { PresenceBadge } from '@/components/PresenceBadge';
import { CallTimer } from '@/components/CallTimer';
import { CallHistory } from '@/components/CallHistory';
import { GoalProgressWidget } from '@/components/interpreters/GoalProgressWidget';
import { AccessActionsRail } from '@/components/AccessActionsRail';
import { OnboardingGate } from '@/components/OnboardingGate';
import { getCurrentProfile } from '@/app/actions/auth';
import prismaClient from '@/lib/prisma';
import { getDayBounds, getMonthBounds, sumEffectiveLogMinutes } from '@/lib/interpreter-metrics';
import { resolveUserRoleByEmail } from '@/lib/admin-identity';
const prisma = prismaClient;

// ── Santo Domingo working-days helper ──
function getSdWorkingDayCount() {
  const now = new Date();
  const sd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santo_Domingo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const [yStr, mStr, dStr] = sd.split('-');
  const y = Number(yStr), m = Number(mStr), d = Number(dStr);

  const daysInMonth = new Date(y, m, 0).getDate();
  let total = 0, passed = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    // Noon UTC so the UTC day-of-week matches the Santo Domingo day-of-week
    const dow = new Date(Date.UTC(y, m - 1, day, 12, 0, 0)).getUTCDay();
    const isWorkingDay = dow !== 0 && dow !== 6;
    if (isWorkingDay) total++;
    if (isWorkingDay && day <= d) passed++;
  }
  return { total, passed, remaining: total - passed };
}

export const dynamic = 'force-dynamic';

export default async function InterpreterDashboard() {
  const { userId, user } = await auth();
  if (!userId || !user) redirect('/login');

  let profile = await getCurrentProfile();

  // ── AUTO-REPAIR: If profile is missing but user exists in Auth ──
  if (!profile) {
    console.warn(`[DASHBOARD] Profile missing for user ${userId}, attempting auto-repair...`);
    try {
      // Determine role for new profile — default is interpreter.
      // Admin promotion is explicit-only (DB/admin action), never inferred
      // from email patterns to prevent unauthorized escalation.
      const role = resolveUserRoleByEmail(user.email, 'interpreter');

      // Use Prisma for auto-repair — broader matching (email or name)
      const interpreter = await prisma.interpreter.findFirst({
        where: {
          OR: [
            { emailCorporativo: user.email },
            { name: user.displayName || user.email?.split('@')[0] },
          ],
        },
        select: { id: true }
      });

      // AUTO-CREATE: If no matching interpreter, create one (only for interpreters)
      let interpreterId: number | null = role === 'interpreter' ? (interpreter?.id || null) : null;
      if (!interpreterId && role === 'interpreter') {
        const displayName = user.user_metadata?.display_name || user.email?.split('@')[0] || 'Interpreter';
        try {
          const newInterp = await prisma.interpreter.create({
            data: {
              externalId: `auth-${userId}`,
              name: displayName,
              emailCorporativo: user.email || undefined,
              status: 'Activo',
              realtimeStatus: 'Offline',
              tariffPerMinute: 0,
              monthlyGoal: 2000,
              languageA: 'Español',
              languageB: 'Inglés',
            },
            select: { id: true },
          });
          interpreterId = newInterp.id;
          console.log(`🔧 [DASHBOARD] Interpreter auto-created for ${userId} → interpreter ${newInterp.id}`);
        } catch (createErr: any) {
          if (createErr?.code === 'P2002') {
            // Find existing instead of creating a duplicate
            const existing = await prisma.interpreter.findFirst({
              where: {
                OR: [
                  { emailCorporativo: user.email || undefined },
                  { externalId: `auth-${userId}` },
                ],
              },
              select: { id: true },
            });
            if (existing) {
              interpreterId = existing.id;
              console.log(`🔧 [DASHBOARD] Interpreter already exists for ${userId} → interpreter ${existing.id}`);
            } else {
              const fallbackInterp = await prisma.interpreter.create({
                data: {
                  externalId: `auth-${userId}-${Date.now()}`,
                  name: displayName,
                  status: 'Activo',
                  realtimeStatus: 'Offline',
                  tariffPerMinute: 0,
                  monthlyGoal: 2000,
                  languageA: 'Español',
                  languageB: 'Inglés',
                },
                select: { id: true },
              });
              interpreterId = fallbackInterp.id;
              console.log(`🔧 [DASHBOARD] Interpreter auto-created (fallback) for ${userId} → interpreter ${fallbackInterp.id}`);
            }
          } else {
            console.error('[DASHBOARD] Interpreter auto-creation failed:', createErr);
          }
        }
      }

      const newProfile: any = await prisma.userProfile.upsert({
        where: { id: userId },
        update: {
          email: user.email || '',
          displayName: user.user_metadata?.display_name || user.email?.split('@')[0] || 'Interpreter',
          role: role,
          interpreterId: interpreterId,
        },
        create: {
          id: userId,
          email: user.email || '',
          displayName: user.user_metadata?.display_name || user.email?.split('@')[0] || 'Interpreter',
          role: role,
          interpreterId: interpreterId,
        }
      });

      if (newProfile) {
        console.log(`[DASHBOARD] Profile auto-repaired for ${userId}`);
        profile = {
          id: newProfile.id,
          email: newProfile.email,
          role: newProfile.role as any,
          interpreter_id: newProfile.interpreterId,
          display_name: newProfile.displayName || '',
          terms_accepted_at: newProfile.termsAcceptedAt?.toISOString() || null,
          signature_date: newProfile.signatureDate?.toISOString() || null,
          bank_name: newProfile.bankName,
          bank_account: newProfile.bankAccount,
          bank_account_type: newProfile.bankAccountType,
          bank_cedula: newProfile.bankCedula,
          onboarding_complete: newProfile.onboardingComplete || false,
          created_at: newProfile.createdAt.toISOString(),
        };
      }
    } catch (err) {
      console.error('[DASHBOARD] Auto-repair failed via Prisma:', err);
    }

  }

  // Admin promotion removed from runtime flow. Admin status is explicit-only;
  // granting admin requires a direct DB operation by an authorized operator.

  // ── AUTO-REPAIR: Link interpreter when profile exists but interpreter_id is null (skip for admins) ──
  if (profile && !profile.interpreter_id && profile.role !== 'admin') {
    console.warn(`[DASHBOARD] Profile exists for ${userId} but interpreter_id is null, attempting link repair...`);
    try {
      const interpreterMatch = await prisma.interpreter.findFirst({
        where: {
          OR: [
            { emailCorporativo: user.email },
            { name: user.displayName || user.email?.split('@')[0] },
          ],
        },
        select: { id: true },
      });

      if (interpreterMatch) {
        await prisma.userProfile.update({
          where: { id: userId },
          data: { interpreterId: interpreterMatch.id },
        });
        profile = {
          ...profile,
          interpreter_id: interpreterMatch.id,
        };
        console.log(`[DASHBOARD] Interpreter link auto-repaired for ${userId} → interpreter ${interpreterMatch.id}`);
      } else {
        // AUTO-CREATE: No matching interpreter — create one and link it (admins excluded by outer condition)
        const displayName = user.user_metadata?.display_name || user.email?.split('@')[0] || 'Interpreter';
        let newInterpreter: { id: number } | null = null;
        try {
          newInterpreter = await prisma.interpreter.create({
            data: {
              externalId: `auth-${userId}`,
              name: displayName,
              emailCorporativo: user.email || undefined,
              status: 'Activo',
              realtimeStatus: 'Offline',
              tariffPerMinute: 0,
              monthlyGoal: 2000,
              languageA: 'Español',
              languageB: 'Inglés',
            },
            select: { id: true },
          });
        } catch (createErr: any) {
          if (createErr?.code === 'P2002') {
            // Find existing instead of creating a duplicate
            const existing = await prisma.interpreter.findFirst({
              where: {
                OR: [
                  { emailCorporativo: user.email || undefined },
                  { externalId: `auth-${userId}` },
                ],
              },
              select: { id: true },
            });
            if (existing) {
              newInterpreter = existing;
            } else {
              newInterpreter = await prisma.interpreter.create({
                data: {
                  externalId: `auth-${userId}-${Date.now()}`,
                  name: displayName,
                  status: 'Activo',
                  realtimeStatus: 'Offline',
                  tariffPerMinute: 0,
                  monthlyGoal: 2000,
                  languageA: 'Español',
                  languageB: 'Inglés',
                },
                select: { id: true },
              });
            }
          } else {
            throw createErr;
          }
        }
        if (newInterpreter) {
          await prisma.userProfile.update({
            where: { id: userId },
            data: { interpreterId: newInterpreter.id },
          });
          profile = { ...profile, interpreter_id: newInterpreter.id };
          console.log(`🔧 [DASHBOARD] Interpreter auto-created and linked for ${userId} → interpreter ${newInterpreter.id}`);
        }
      }
    } catch (err) {
      console.error('[DASHBOARD] Interpreter link repair failed:', err);
    }
  }

  if (profile && profile.role === 'admin') {
    redirect('/admin');
  }

  const { startOfMonth, endOfMonth } = getMonthBounds();
  const { startOfDay: todayStart, endOfDay: todayEnd } = getDayBounds();

  const globalGoalHours = parseFloat(await getSystemConfig('standard_monthly_goal_hours', '120'));

  // Fetch full data if we have an interpreter link
  let interpreter: any = null;
  let activeCall: any = null;
  let recentCalls: any[] = [];
  let monthLogs: any[] = [];
  let todayLogs: any[] = [];
  let rankings: any[] = [];
  let myRankIdx = -1;

  if (profile?.interpreter_id) {
    try {
      interpreter = await prisma.interpreter.findUnique({
        where: { id: profile.interpreter_id },
        select: {
          id: true,
          name: true,
          status: true,
          realtimeStatus: true,
          campaign: true,
          languageA: true,
          languageB: true,
          tariffPerMinute: true,
          monthlyGoal: true,
          productionLogs: {
            where: { date: { gte: startOfMonth, lte: endOfMonth } },
            select: { date: true, interpretedMinutes: true, verifiedMinutes: true }
          },
          qaScores: {
            take: 5,
            orderBy: { createdAt: 'desc' },
            select: { totalScore: true }
          }
        }
      } as any);

      if (interpreter) {
        const [activeCallRes, recentCallsRes, monthLogsRes, todayLogsRes, allInterpreters] = await Promise.all([
          prisma.callSession.findFirst({
            where: { interpreterId: interpreter.id, endedAt: null },
            orderBy: { startedAt: 'desc' }
          }),
          prisma.callSession.findMany({
            where: { interpreterId: interpreter.id, endedAt: { not: null } },
            orderBy: { startedAt: 'desc' },
            take: 10
          }),
          prisma.productionLog.findMany({
            where: {
              interpreterId: interpreter.id,
              date: { gte: startOfMonth, lte: endOfMonth },
            },
            select: { date: true, interpretedMinutes: true, verifiedMinutes: true }
          }),
          prisma.productionLog.findMany({
            where: {
              interpreterId: interpreter.id,
              date: { gte: todayStart, lte: todayEnd },
            },
            select: { date: true, interpretedMinutes: true, verifiedMinutes: true }
          }),
          prisma.interpreter.findMany({
            select: {
              id: true,
              name: true,
              campaign: true,
              monthlyGoal: true,
              productionLogs: {
                where: { date: { gte: startOfMonth, lte: endOfMonth } },
                select: { interpretedMinutes: true, verifiedMinutes: true },
              },
              qaScores: {
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: { totalScore: true },
              },
            },
          } as any)
        ]);

        activeCall = activeCallRes;
        recentCalls = recentCallsRes;
        monthLogs = monthLogsRes;
        todayLogs = todayLogsRes;

        // Process rankings
        rankings = allInterpreters
          .map((interp: any) => {
            const totalMinutes = sumEffectiveLogMinutes(interp.productionLogs);
            const qaScore = interp.qaScores?.[0]?.totalScore ? Number(interp.qaScores[0].totalScore) : 0;
            const monthlyGoalVal = interp.monthlyGoal ?? (globalGoalHours * 60);
            const goalProgress = Math.min((totalMinutes / monthlyGoalVal) * 100, 100);

            return {
              id: interp.id,
              name: interp.name,
              campaign: interp.campaign,
              totalMinutes,
              qaScore,
              monthlyGoal: monthlyGoalVal,
              goalProgress,
            };
          })
          .sort((a: any, b: any) => {
            if (b.totalMinutes !== a.totalMinutes) return b.totalMinutes - a.totalMinutes;
            return b.qaScore - a.qaScore;
          });

        myRankIdx = rankings.findIndex((r: any) => r.id === interpreter.id);
      }
    } catch (error) {
      console.error('❌ DASHBOARD: Data fetch failed:', error);
    }
  }

  // ── 📊 METRICS CALCULATION ──
  // Production logs are the source of truth — do NOT add activeCallMinutes
  // to avoid double-counting when calls are later saved to production logs.
  const todayMinutes = sumEffectiveLogMinutes(todayLogs);
  const mtdMinutes = sumEffectiveLogMinutes(monthLogs);
  const monthlyGoal = interpreter?.monthlyGoal || (globalGoalHours * 60);

  // ── Enhanced goal tracking (working days in Santo Domingo) ──
  const wd = getSdWorkingDayCount();
  const mtdRemaining = Math.max(0, monthlyGoal - mtdMinutes);
  const currentPace = wd.passed > 0 ? Math.round(mtdMinutes / wd.passed) : 0;
  const requiredPace = wd.remaining > 0 ? Math.round(mtdRemaining / wd.remaining) : 0;
  const projectedMinutes = mtdMinutes + (currentPace * wd.remaining);
  const projectedOnTrack = projectedMinutes >= monthlyGoal;

  const mtdProgress = Math.min((mtdMinutes / monthlyGoal) * 100, 100);

  // Daily target: monthly goal distributed over 22 working days
  const dailyGoal = monthlyGoal / 22;
  const todayProgress = Math.min((todayMinutes / dailyGoal) * 100, 100);

  const latestQaScore = interpreter?.qaScores?.[0]?.totalScore ? Number(interpreter.qaScores[0].totalScore) : 0;
  const isQaExcellent = latestQaScore >= 95;

  // ── Q1 / Q2 Goal Progress ──
  const now = new Date();
  const isQ1 = now.getDate() < 16;
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const q1End = new Date(currentYear, currentMonth, 15, 23, 59, 59);

  const q1Logs = monthLogs.filter((log: any) => new Date(log.date) <= q1End);
  const q2Logs = monthLogs.filter((log: any) => new Date(log.date) > q1End);

  const q1Minutes = sumEffectiveLogMinutes(q1Logs);
  const q2Minutes = sumEffectiveLogMinutes(q2Logs);
  const baseTariff = interpreter?.tariffPerMinute ? Number(interpreter.tariffPerMinute) : 5;

  const mtdEarnings = mtdMinutes * Number(interpreter?.tariffPerMinute || 0);
  const onboardingComplete = profile?.onboarding_complete || false;

  if (!profile || !interpreter) {
    return (
      <div className="flex items-center justify-center min-h-[80vh]">
        <div className="glass p-10 rounded-[2.5rem] text-center max-w-lg border border-white/5 shadow-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-32 bg-orange-500/10 blur-[100px] rounded-full -mr-16 -mt-16" />

          <div className="relative z-10">
            <div className="w-20 h-20 bg-orange-500/10 rounded-3xl flex items-center justify-center text-orange-400 mx-auto mb-6 border border-orange-500/20">
              <ShieldCheck size={40} />
            </div>

            <h2 className="text-3xl font-black text-white mb-4 tracking-tight">Acceso Restringido</h2>
            <p className="text-slate-300 leading-relaxed mb-8">
              {!profile
                ? "No pudimos localizar tu perfil de usuario en el sistema."
                : "Tu cuenta de usuario no está vinculada a un perfil de intérprete activo."}
              <br />
              <span className="text-slate-500 text-sm mt-4 block">
                Por favor, contacta al administrador para completar tu vinculación de ID corporativo.
              </span>
            </p>

            <div className="flex flex-col gap-3">
              <a
                href="/dashboard"
                className="flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 text-white px-6 py-4 rounded-2xl font-bold transition-all border border-white/5"
              >
                <RefreshCw size={18} />
                Reintentar Conexión
              </a>
              <a
                href="/login"
                className="flex items-center justify-center gap-2 text-slate-400 hover:text-white transition-colors text-sm font-medium"
              >
                <LogIn size={14} />
                Cerrar Sesión e Identificarse
              </a>
            </div>

            <div className="mt-10 pt-8 border-t border-white/5">
              <p className="text-[10px] text-orange-500 font-black uppercase tracking-[0.2em]">
                System Diagnostic: {profile ? 'INTERPRETER_LINK_MISSING' : 'PROFILE_MISSING_IN_DB'}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Onboarding gate — shows wizard if not completed */}
      <OnboardingGate
        isComplete={onboardingComplete}
        interpreterName={interpreter.name}
      />

      <div className="space-y-8 animate-in fade-in duration-700">
        {/* Hero Section & Gamification */}
        <div className="relative rounded-3xl overflow-hidden bg-gradient-to-br from-indigo-900/50 to-slate-900 border border-indigo-500/20 p-8 shadow-2xl">
          <div className="absolute top-0 right-0 p-32 bg-indigo-500/10 blur-[100px] rounded-full pointer-events-none" />
          <div className="absolute bottom-0 left-0 p-32 bg-emerald-500/10 blur-[100px] rounded-full pointer-events-none" />

          <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h2 className="text-3xl font-bold text-white tracking-tight">Hola, {interpreter.name}</h2>
                {isQaExcellent && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                    Top Tier QA ✨
                  </span>
                )}
              </div>
              <p className="text-slate-200 font-medium">
                {interpreter.languageA} ↔ {interpreter.languageB}
                {interpreter.campaign && <span className="ml-3 text-indigo-300">• {interpreter.campaign}</span>}
              </p>
            </div>
            <PresenceBadge />
          </div>

          <div className="relative z-10 grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
            {/* MTD Progress — DYNAMIC GOAL with enhanced tracking */}
            <div className="bg-slate-900/50 rounded-2xl p-6 border border-white/5 backdrop-blur-sm">
              <div className="flex justify-between items-end mb-4">
                <div>
                  <p className="text-sm text-white font-semibold mb-1">Horas MTD</p>
                  <p className="text-3xl font-bold text-white">
                    <span suppressHydrationWarning>{(mtdMinutes / 60).toFixed(1)}</span>
                    <span className="text-lg text-slate-300"> / {Math.round(monthlyGoal / 60)}</span>
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-indigo-500/10 text-indigo-400">
                  <Clock size={24} />
                </div>
              </div>
              <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 to-indigo-400 rounded-full relative"
                  style={{ width: `${mtdProgress}%` }}
                >
                  <div className="absolute inset-0 bg-white/20 animate-pulse" />
                </div>
              </div>

              {/* ── Enhanced meta / avances tracking ── */}
              <div className="mt-4 space-y-2.5 text-sm" suppressHydrationWarning>
                <div className="flex justify-between text-slate-300">
                  <span>Faltan</span>
                  <span className="font-semibold text-white">{(mtdRemaining / 60).toFixed(1)} hrs ({mtdRemaining} min)</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>Días laborables restantes</span>
                  <span className="font-semibold text-white">{wd.remaining} de {wd.total}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>Ritmo actual</span>
                  <span className="font-semibold text-white">{currentPace} min/día</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>Ritmo necesario</span>
                  <span className={`font-semibold ${requiredPace > currentPace ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {requiredPace} min/día
                  </span>
                </div>
                <div className="flex justify-between text-slate-300 pt-1.5 border-t border-white/5">
                  <span>Proyección</span>
                  <span className={`font-semibold ${projectedOnTrack ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {projectedOnTrack ? '✅ En camino' : `⚠️ ${(projectedMinutes / 60).toFixed(1)} hrs`}
                  </span>
                </div>
              </div>
            </div>

            {/* Meta Diaria Progress */}
            <div className="bg-slate-900/50 rounded-2xl p-6 border border-white/5 backdrop-blur-sm">
              <div className="flex justify-between items-end mb-4">
                <div>
                  <p className="text-sm text-white font-semibold mb-1">Meta Diaria</p>
                  <p className="text-3xl font-bold text-white">
                    <span suppressHydrationWarning>{Math.round(todayMinutes)}</span>
                    <span className="text-lg text-slate-300"> / {Math.round(dailyGoal)} min</span>
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400">
                  <TrendingUp size={24} />
                </div>
              </div>

              <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full relative"
                  style={{ width: `${todayProgress}%` }}
                >
                  <div className="absolute inset-0 bg-white/20 animate-pulse" />
                </div>
              </div>

              <p suppressHydrationWarning className="text-xs text-slate-200 mt-2 text-right font-medium">
                {todayProgress.toFixed(1)}% completado (Faltan {Math.max(0, Math.round(dailyGoal - todayMinutes))} min)
              </p>
            </div>

            {/* Earnings — IMPROVED CONTRAST */}
            <div className="bg-slate-900/50 rounded-2xl p-6 border border-white/5 backdrop-blur-sm flex flex-col justify-center">
              <div className="flex justify-between items-center mb-2">
                <p className="text-sm text-white font-semibold">Ganancias MTD</p>
                <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400">
                  <DollarSign size={20} />
                </div>
              </div>
              <div className="flex items-baseline gap-2">
                <p className="text-4xl font-bold text-white tracking-tight">
                  RD${mtdEarnings.toFixed(2)}
                </p>
                <span className="text-slate-300 text-sm font-medium">({(mtdMinutes / 60).toFixed(1)} hrs)</span>
              </div>
              <p className="text-xs text-slate-200 mt-2 font-medium">Tarifa: RD${(Number(interpreter.tariffPerMinute || 0) * 60).toFixed(2)}/hr</p>
            </div>
          </div>

          <GoalProgressWidget
            monthlyGoal={monthlyGoal}
            q1Minutes={q1Minutes}
            q2Minutes={q2Minutes}
            isQ1={isQ1}
            tariffPerMinute={baseTariff}
          />
        </div>

        {/* Quick Tools & Production Registry */}
        <div className="w-full">
          {/* Call Timer */}
          <div className="glass rounded-3xl p-8 border border-white/5 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-16 bg-blue-500/5 blur-[50px] rounded-full -mr-8 -mt-8 pointer-events-none" />
            <div className="flex items-center justify-between mb-6 relative z-10">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400">
                  <TrendingUp size={22} />
                </div>
                <h3 className="text-xl font-bold text-white tracking-tight">Temporizador en Vivo</h3>
              </div>
              <span className="text-[10px] font-black text-blue-500 bg-blue-500/10 px-2 py-1 rounded-md uppercase tracking-wider border border-blue-500/20">Realtime</span>
            </div>
            <div className="relative z-10">
              <CallTimer
                activeCall={activeCall ? {
                  sessionId: activeCall.id,
                  startedAt: activeCall.startedAt.toISOString(),
                  tariffSnapshot: Number(activeCall.tariffSnapshot),
                } : null}
                currentRate={Number(interpreter.tariffPerMinute)}
              />
              {/* Access Actions Rail injected here for seamless platform navigation */}
              <AccessActionsRail userId={userId} />
            </div>
          </div>
        </div>

        {/* Recent Calls */}
        <CallHistory
          calls={recentCalls.map((c: any) => ({
            id: c.id,
            started_at: c.startedAt.toISOString(),
            ended_at: c.endedAt?.toISOString() || null,
            duration_seconds: c.durationSeconds,
            call_cost: Number(c.callCost),
            tariff_snapshot: Number(c.tariffSnapshot)
          }))}
        />
      </div>
    </>
  );
}
