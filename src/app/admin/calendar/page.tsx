import React from 'react';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/actions';
import { getComplianceBoard } from '@/app/actions/calendar';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, CalendarDays, TrendingUp } from 'lucide-react';
import LiveStatusCell from '@/components/admin/LiveStatusCell';

export const dynamic = 'force-dynamic';

export default async function AdminCalendarPage(props: { searchParams: Promise<{ month?: string; year?: string }> }) {
  const userData = await getCurrentUser();

  if (!userData) {
    redirect('/login');
  }

  const profile = userData.profile;

  if (profile?.role !== 'admin') {
    redirect('/dashboard');
  }

  const searchParams = await props.searchParams;
  const currentDate = new Date();
  const year = searchParams.year ? parseInt(searchParams.year) : currentDate.getFullYear();
  const month = searchParams.month ? parseInt(searchParams.month) : currentDate.getMonth() + 1;

  const board = await getComplianceBoard(year, month);

  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;

  const formatMinutes = (mins: number) => new Intl.NumberFormat('en-US').format(mins);

  return (
    <div className="p-0 sm:p-4 lg:p-8 max-w-full mx-auto text-[var(--foreground)]">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-500/20 rounded-xl">
            <CalendarDays className="w-6 h-6 text-[var(--theme-link)]" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-[var(--theme-link)]">
              Tablero de Cumplimiento
            </h1>
            <p className="text-sm text-[var(--text-secondary)] mt-1">Mapa de actividad mensual e indicadores de rendimiento</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2 bg-[var(--theme-panel)] p-1.5 rounded-xl border border-[var(--border)]">
          <Link 
            href={`/admin/calendar?year=${prevYear}&month=${prevMonth}`}
            aria-label="Mes anterior"
            className="theme-action-secondary p-2 rounded-lg transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-[var(--text-secondary)]" />
          </Link>
          <div className="px-2 sm:px-4 py-2 font-bold text-[var(--theme-link)] min-w-0 sm:min-w-[160px] text-center">
            {new Date(year, month - 1).toLocaleString('es-ES', { month: 'long', year: 'numeric' }).toUpperCase()}
          </div>
          <Link 
            href={`/admin/calendar?year=${nextYear}&month=${nextMonth}`}
            aria-label="Mes siguiente"
            className="theme-action-secondary p-2 rounded-lg transition-colors"
          >
            <ChevronRight className="w-5 h-5 text-[var(--text-secondary)]" />
          </Link>
        </div>
      </div>

      <div role="region" aria-label="Calendario mensual de cumplimiento" tabIndex={0} className="max-w-full overflow-x-auto bg-[var(--theme-panel)] rounded-2xl border border-[var(--border)] shadow-2xl relative">
        <table className="w-full text-left text-sm whitespace-nowrap border-collapse">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--theme-panel)] backdrop-blur-md">
              <th className="p-4 font-bold text-[var(--foreground)] xl:sticky xl:left-0 bg-[var(--theme-panel)] z-20 shadow-[4px_0_10px_-4px_rgba(0,0,0,0.5)] border-r border-[var(--border)] min-w-[220px] w-[220px] xl:min-w-[340px] xl:w-[340px]">
                <div className="flex items-center gap-3">
                  <span>Intérprete</span>
                  <span className="text-[9px] uppercase tracking-wider font-normal text-[var(--text-tertiary)]">/ Estado</span>
                </div>
              </th>
              {/* Resumen Mes actual */}
              <th className="p-4 text-center font-bold text-[var(--text-secondary)] bg-[var(--theme-panel)] z-20 border-r border-[var(--border)] min-w-[80px] w-[80px]">
                <div className="flex items-center justify-center gap-1"><TrendingUp className="w-4 h-4 text-[var(--theme-success)]"/> Mes actual</div>
              </th>
              <th className="p-4 text-center font-bold text-[var(--text-secondary)] bg-[var(--theme-panel)] z-20 border-r border-[var(--border)] min-w-[80px] w-[80px]">
                Meta
              </th>
              <th className="p-4 text-center font-bold text-[var(--text-secondary)] bg-[var(--theme-panel)] z-20 border-r border-[var(--border)] shadow-[4px_0_10px_-4px_rgba(0,0,0,0.5)] min-w-[70px] w-[70px]">
                %
              </th>

              {board[0]?.days.map((d) => (
                <th key={d.date} className={`p-2 min-w-[48px] text-center text-xs font-bold ${d.isWeekend ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-secondary)]'}`}>
                  {d.date.split('-')[2]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {board.map((row) => (
              <tr key={row.interpreter.id} className="border-b border-[var(--border)] hover:bg-[var(--theme-hover)] transition-colors group">
                <td className="p-4 font-semibold xl:sticky xl:left-0 bg-[var(--theme-panel)] group-hover:bg-[var(--theme-hover)] z-10 shadow-[4px_0_10px_-4px_rgba(0,0,0,0.5)] border-r border-[var(--border)] min-w-[220px] w-[220px] xl:min-w-[340px] xl:w-[340px]">
                  <div className="flex items-center gap-3">
                    <LiveStatusCell interpreterId={row.interpreter.id} />
                    <span className="min-w-0 max-w-[160px] xl:max-w-[270px] truncate" title={row.interpreter.name}>{row.interpreter.name}</span>
                  </div>
                </td>
                
                {/* Columnas Resumen */}
                <td className="p-3 text-center bg-[var(--theme-panel)] group-hover:bg-[var(--theme-hover)] z-10 border-r border-[var(--border)] font-bold text-[var(--theme-success)] min-w-[80px] w-[80px]">
                  {formatMinutes(row.mtdMinutes)}
                </td>
                <td className="p-3 text-center bg-[var(--theme-panel)] group-hover:bg-[var(--theme-hover)] z-10 border-r border-[var(--border)] font-medium text-[var(--text-secondary)] min-w-[80px] w-[80px]">
                  {formatMinutes(row.monthlyGoal)}
                </td>
                <td className="p-3 text-center bg-[var(--theme-panel)] group-hover:bg-[var(--theme-hover)] z-10 border-r border-[var(--border)] shadow-[4px_0_10px_-4px_rgba(0,0,0,0.5)] min-w-[70px] w-[70px]">
                  <span className={`px-2 py-1 rounded text-[10px] font-bold ${
                    row.fulfillmentPercent >= 100 ? 'bg-emerald-500/20 text-[var(--theme-success)]' : 
                    row.fulfillmentPercent >= 75 ? 'bg-amber-500/20 text-[var(--theme-warning)]' : 
                    'bg-rose-500/20 text-[var(--theme-danger)]'
                  }`}>
                    {row.fulfillmentPercent.toFixed(1)}%
                  </span>
                </td>

                {row.days.map((d) => {
                  let bgColor = 'bg-[var(--theme-surface-muted)] text-[var(--text-tertiary)]'; // Weekend not worked
                  
                  if (d.status === 'Overproduction') {
                    bgColor = 'bg-blue-500/20 text-[var(--theme-link)] ring-1 ring-blue-500/30';
                  } else if (d.status === 'Fulfilled') {
                    bgColor = 'bg-emerald-500/20 text-[var(--theme-success)] ring-1 ring-emerald-500/30';
                  } else if (d.status === 'Late') {
                    bgColor = 'bg-amber-500/20 text-[var(--theme-warning)]';
                  } else if (d.status === 'No-Show' && !d.isWeekend) {
                    bgColor = 'bg-rose-500/10 text-[var(--theme-danger)] ring-1 ring-rose-500/20';
                  }
                  
                  return (
                    <td key={d.date} className="p-1">
                      <div className="relative group/tooltip flex justify-center">
                        <div 
                          className={`w-10 h-10 rounded-md flex items-center justify-center text-xs font-bold transition-all hover:scale-110 cursor-default ${bgColor}`}
                        >
                          {d.minutes > 0 ? d.minutes : '-'}
                        </div>
                        
                        {/* Custom Tooltip */}
                        <div className="absolute bottom-full mb-2 hidden group-hover/tooltip:block z-50">
                          <div className="bg-[var(--theme-surface-muted)] border border-[var(--border)] text-[var(--foreground)] text-xs rounded-lg p-3 shadow-xl whitespace-nowrap min-w-[150px]">
                            <p className="font-bold text-[var(--text-secondary)] mb-2 border-b border-[var(--border)] pb-1">{d.date}</p>
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-[var(--text-secondary)]">Histórico CSV:</span>
                              <span className="font-mono text-[var(--theme-success)]">{formatMinutes(d.logsMinutes)} min</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-[var(--text-secondary)]">Sesiones en vivo:</span>
                              <span className="font-mono text-[var(--theme-link)]">{formatMinutes(d.sessionsMinutes)} min</span>
                            </div>
                            <div className="flex justify-between items-center mt-2 pt-1 border-t border-[var(--border)]">
                              <span className="text-[var(--text-secondary)] font-bold">Total:</span>
                              <span className="font-mono font-bold text-[var(--foreground)]">{formatMinutes(d.minutes)} min</span>
                            </div>
                          </div>
                          {/* Tooltip Arrow */}
                          <div className="w-3 h-3 bg-[var(--theme-surface-muted)] border-r border-b border-[var(--border)] transform rotate-45 absolute -bottom-1.5 left-1/2 -translate-x-1/2"></div>
                        </div>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
