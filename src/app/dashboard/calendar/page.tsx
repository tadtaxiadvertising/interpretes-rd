import React from 'react';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/actions';
import { getInterpreterCommitment, getMonthlyProgress } from '@/app/actions/calendar';
import { Flame, Trophy, TrendingUp, AlertCircle, CalendarDays } from 'lucide-react';

export default async function InterpreterCalendarPage() {
  const userData = await getCurrentUser();

  if (!userData) {
    redirect('/login');
  }

  const profile = userData.profile;

  if (!profile || !profile.interpreterId) {
    return <div className="p-4 sm:p-8 text-[var(--foreground)]">No se encontró el perfil de intérprete.</div>;
  }

  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo' }).format(new Date());
  const commitment = await getInterpreterCommitment(profile.interpreterId, todayStr);
  const monthly = await getMonthlyProgress(profile.interpreterId);

  const tariff = commitment.interpreter.tariffPerMinute ? Number(commitment.interpreter.tariffPerMinute) : 0;
  const recoveryMoney = commitment.deficit * tariff;

  const formatMinutes = (mins: number) => new Intl.NumberFormat('en-US').format(mins);
  const formatMoney = (amount: number) => `RD$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount)}`;

  // Gamification states
  const isOverachieving = commitment.healthScore > 100;

  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto text-[var(--foreground)]">
      <div className="flex flex-wrap items-center gap-3 mb-6 sm:mb-8">
        <div className="p-3 bg-blue-500/20 rounded-xl">
          <CalendarDays className="w-6 h-6 text-[var(--theme-link)]" />
        </div>
        <h1 className="brand-heading text-2xl sm:text-3xl font-bold leading-tight">
          Mi Calendario de Metas
        </h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Weekly Progress Card */}
        <div className="bg-[var(--theme-panel)] border border-[var(--border)] rounded-2xl p-6 relative overflow-hidden group hover:border-[var(--theme-control-border)] transition-all duration-300">
          {isOverachieving && (
            <div className="absolute top-0 right-0 p-4 animate-pulse">
              <span className="flex items-center gap-1 text-xs font-bold text-[var(--theme-success)] bg-emerald-500/10 px-2 py-1 rounded-full border border-emerald-500/20 shadow-[0_0_10px_rgba(52,211,153,0.3)]">
                <Trophy className="w-3 h-3" /> Sobreproducción
              </span>
            </div>
          )}

          <div className="relative z-10">
            <h2 className="text-lg font-semibold text-[var(--text-secondary)] mb-2 flex items-center gap-2">
              Progreso Semanal
              <TrendingUp className="w-4 h-4 text-[var(--theme-link)]" />
            </h2>
            <div className="flex flex-wrap items-end gap-2">
              <span className="text-4xl sm:text-5xl font-black text-[var(--foreground)] tracking-tight break-words">{formatMinutes(commitment.totalMinutesWeek)}</span>
              <span className="text-[var(--text-secondary)] mb-2 font-medium">/ {formatMinutes(commitment.targetMinutesToDate)} min esperados</span>
            </div>

            <div className="mt-5 h-3 bg-[var(--theme-track)] rounded-full overflow-hidden border border-[var(--border)]">
              <div
                className={`h-full rounded-full transition-all duration-1000 ease-out ${isOverachieving ? 'bg-[var(--theme-success)]' :
                  commitment.healthScore >= 100 ? 'bg-[var(--theme-success)]' :
                    commitment.healthScore >= 80 ? 'bg-[var(--theme-warning)]' : 'bg-[var(--theme-danger)]'
                  }`}
                style={{ width: `${Math.min(100, commitment.healthScore)}%` }}
              />
            </div>
            <div className="flex justify-between items-center mt-3">
              <p className="text-sm font-medium text-[var(--text-secondary)]">Indicador de cumplimiento</p>
              <p className={`text-lg font-bold ${isOverachieving ? 'text-[var(--theme-success)] drop-shadow-[0_0_8px_rgba(52,211,153,0.8)]' :
                commitment.healthScore >= 100 ? 'text-[var(--theme-success)]' :
                  commitment.healthScore >= 80 ? 'text-[var(--theme-warning)]' : 'text-[var(--theme-danger)]'
                }`}>
                {commitment.healthScore}%
              </p>
            </div>
          </div>
        </div>

        {/* Motivation & Recovery Card */}
        {commitment.deficit > 0 ? (
          <div className="bg-[var(--theme-panel)] border border-rose-500/20 rounded-2xl p-6 relative overflow-hidden group hover:border-rose-500/40 transition-all duration-300">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <AlertCircle className="w-24 h-24 text-[var(--theme-danger)]" />
            </div>
            <h2 className="text-lg font-bold text-[var(--theme-danger)] mb-2">¡Completa tu meta de producción!</h2>
            <p className="text-sm text-[var(--text-secondary)] mb-5 leading-relaxed">
              El fin de semana es tu oportunidad. Recupera tus <span className="font-bold text-[var(--theme-danger)]">{formatMinutes(commitment.deficit)} minutos</span> pendientes y asegura <span className="font-bold text-[var(--theme-success)]">{formatMoney(recoveryMoney)} extra</span> en tu próximo pago.
            </p>

            {commitment.recoverySuggestions && (
              <div className="space-y-3 relative z-10">
                <div className="bg-[var(--theme-surface-muted)] p-4 rounded-xl flex justify-between items-center border border-[var(--border)]">
                  <span className="text-[var(--foreground)] font-medium">Sábado</span>
                  <span className="font-bold text-[var(--theme-success)] bg-emerald-500/10 px-3 py-1 rounded-lg">+{formatMinutes(commitment.recoverySuggestions.saturdayMinutes)} min</span>
                </div>
                <div className="bg-[var(--theme-surface-muted)] p-4 rounded-xl flex justify-between items-center border border-[var(--border)]">
                  <span className="text-[var(--foreground)] font-medium">Domingo</span>
                  <span className="font-bold text-[var(--theme-success)] bg-emerald-500/10 px-3 py-1 rounded-lg">+{formatMinutes(commitment.recoverySuggestions.sundayMinutes)} min</span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-[var(--theme-panel)] border border-emerald-500/30 rounded-2xl p-6 flex flex-col justify-center items-center text-center group hover:border-emerald-500/60 transition-all duration-300">
            <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
              <Trophy className="w-8 h-8 text-[var(--theme-success)]" />
            </div>
            <h2 className="text-2xl font-bold text-[var(--theme-success)] mb-2">¡Meta cumplida!</h2>
            <p className="text-[var(--text-secondary)] max-w-[250px]">
              Estás al día con tus metas. Todo lo que hagas ahora es <span className="text-[var(--theme-success)] font-bold">ganancia extra pura</span>. ¡Sigue así!
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 mb-6 mt-10">
        <h2 className="text-xl font-bold text-[var(--foreground)]">Registro Diario</h2>
        <span className="text-xs font-medium text-[var(--text-tertiary)] bg-[var(--theme-surface-muted)] px-2 py-1 rounded-md">Meta: {formatMinutes(commitment.dailyGoalMinutes)} min/día</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
        {commitment.dailyStats.map((stat) => {
          const isOverproducing = stat.minutes >= (commitment.dailyGoalMinutes * 1.1);
          const isMet = stat.minutes >= commitment.dailyGoalMinutes;
          const isToday = stat.date === todayStr;

          return (
            <div
              key={stat.date}
              className={`relative p-5 rounded-2xl border transition-all duration-300
                ${isOverproducing
                  ? 'bg-gradient-to-br from-amber-500/10 to-amber-600/5 border-amber-500/40 shadow-[0_0_15px_rgba(245,158,11,0.15)]'
                  : isMet
                    ? 'bg-emerald-500/10 border-emerald-500/20 hover:border-emerald-500/40'
                    : 'bg-[var(--theme-panel)] border-[var(--border)] hover:border-[var(--theme-control-border)]'
                } 
                ${isToday ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-[var(--background)]' : ''}
              `}
            >
              {isOverproducing && (
                <div className="absolute -top-3 -right-3">
                  <div className="bg-amber-500 text-amber-950 p-1.5 rounded-full shadow-lg shadow-amber-500/20 animate-pulse">
                    <Flame className="w-4 h-4 fill-amber-950" />
                  </div>
                </div>
              )}

              <p className={`text-xs font-medium mb-3 ${isMet ? 'text-[var(--text-secondary)]' : 'text-[var(--text-tertiary)]'}`}>
                {new Date(stat.date + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase()}
              </p>

              <div className="flex items-baseline gap-1">
                <p className={`text-3xl font-black tracking-tight ${isOverproducing ? 'text-[var(--theme-warning)]' :
                  isMet ? 'text-[var(--theme-success)]' : 'text-[var(--foreground)]'
                  }`}>
                  {formatMinutes(stat.minutes)}
                </p>
                <span className={`text-sm font-medium ${isMet ? 'text-[var(--theme-success)]' : 'text-[var(--text-tertiary)]'}`}>
                  min
                </span>
              </div>

              {isMet && !isOverproducing && (
                <div className="mt-3 inline-block bg-emerald-500/20 text-[var(--theme-success)] text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-500/20">
                  META LOGRADA
                </div>
              )}
              {isOverproducing && (
                <div className="mt-3 inline-block bg-amber-500/20 text-[var(--theme-warning)] text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-500/20">
                  FUEGO 🔥
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Monthly Progress Calendar Grid ── */}
      <div className="mt-12 bg-[var(--theme-panel)] border border-[var(--border)] rounded-2xl p-3 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-500/10 text-[var(--theme-purple)]">
              <CalendarDays size={18} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[var(--foreground)]">Progreso Mensual</h2>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                {formatMinutes(monthly.mtdMinutes)} / {formatMinutes(monthly.monthlyGoal)} min
                <span className="ml-2 text-[var(--text-tertiary)]">
                  ({monthly.monthlyGoal > 0 ? Math.round((monthly.mtdMinutes / monthly.monthlyGoal) * 100) : 0}%)
                </span>
              </p>
            </div>
          </div>
          <span className="text-xs font-medium text-[var(--text-tertiary)] bg-[var(--theme-surface-muted)] px-2 py-1 rounded-md">
            Meta: {formatMinutes(monthly.dailyGoal)} min/día
          </span>
        </div>

        <div className="grid grid-cols-7 gap-1.5">
          {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((label, i) => (
            <div key={`h-${i}`} className="text-center text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider py-1">
              {label}
            </div>
          ))}
          {Array.from({ length: monthly.startCol }).map((_, i) => (
            <div key={`e-${i}`} />
          ))}
          {Array.from({ length: monthly.daysInMonth }).map((_, i) => {
            const day = i + 1;
            const dateStr = `${monthly.sdYear}-${String(monthly.sdMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isToday = day === monthly.sdDay;
            const dow = new Date(Date.UTC(monthly.sdYear, monthly.sdMonth - 1, day, 12, 0, 0)).getUTCDay();
            const isWeekend = dow === 0 || dow === 6;
            const isFuture = day > monthly.sdDay;
            const minutes = monthly.dayMap[dateStr] || 0;
            const pct = monthly.dailyGoal > 0 ? Math.round((minutes / monthly.dailyGoal) * 100) : 0;

            let bg = 'bg-[var(--theme-surface-muted)]';
            let txt = 'text-[var(--text-tertiary)]';
            if (isFuture) { bg = 'bg-[var(--theme-panel)]'; txt = 'text-[var(--text-tertiary)]'; }
            else if (isWeekend) { bg = 'bg-[var(--theme-surface-muted)]'; txt = 'text-[var(--text-tertiary)]'; }
            else if (minutes >= monthly.dailyGoal) { bg = 'bg-emerald-500/20'; txt = 'text-[var(--theme-success)]'; }
            else if (minutes > 0) { bg = 'bg-amber-500/10'; txt = 'text-[var(--theme-warning)]'; }
            else { bg = 'bg-red-500/10'; txt = 'text-[var(--theme-danger)]'; }

            return (
              <div
                key={day}
                className={`${bg} ${isToday ? 'ring-2 ring-[var(--theme-focus)]' : ''} rounded-lg px-0.5 py-2 sm:p-2 text-center min-h-[52px] flex flex-col items-center justify-center`}
              >
                <div className={`text-xs font-bold ${txt}`}>{day}</div>
                {!isFuture && !isWeekend && (
                  <div className={`text-[9px] leading-tight mt-0.5 ${txt}`}>
                    {minutes >= monthly.dailyGoal ? '✓' : minutes > 0 ? `${pct}%` : '—'}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-4 mt-4 text-[10px] font-medium text-[var(--text-secondary)]">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/40" /> Meta</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500/30" /> Parcial</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-red-500/30" /> Sin avance</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[var(--theme-surface-muted)]" /> Futuro</span>
        </div>
      </div>
    </div>
  );
}
