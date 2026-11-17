import React from 'react';
import { getCurrentUser } from '@/lib/auth/actions';
import { redirect } from 'next/navigation';
import { Phone } from 'lucide-react';
import { cn } from '@/lib/utils';
import ManualCallForm from './ManualCallForm';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

export default async function AdminCallsPage() {
  const userData = await getCurrentUser();

  if (!userData) redirect('/login');

  const profile = userData.profile;

  if (profile?.role !== 'admin') redirect('/login');

  // Fetch recent calls with interpreter names via Prisma
  const calls = await prisma.callSession.findMany({
    orderBy: { startedAt: 'desc' },
    take: 50,
    select: {
      id: true,
      interpreterId: true,
      startedAt: true,
      endedAt: true,
      durationSeconds: true,
      tariffSnapshot: true,
      callCost: true,
      notes: true,
      interpreter: {
        select: { name: true }
      }
    }
  });

  // Fetch all interpreters for the manual entry form
  const allInterpreters = await prisma.interpreter.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true }
  });

  const nameMap = new Map((allInterpreters || []).map(i => [i.id, i.name]));

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Phone size={28} className="text-green-400" />
            <h2 className="text-3xl font-bold text-white">Historial de llamadas</h2>
          </div>
          <p className="text-gray-400">Registro completo de llamadas con facturación calculada por el servidor. Los importes registrados no se modifican.</p>
        </div>
        <ManualCallForm interpreters={allInterpreters || []} />
      </header>

      <div className="glass rounded-3xl p-8">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-white/5">
                <th className="pb-3 px-2">Intérprete</th>
                <th className="pb-3 px-2">Fecha</th>
                <th className="pb-3 px-2">Inicio</th>
                <th className="pb-3 px-2">Duración</th>
                <th className="pb-3 px-2">Tarifa</th>
                <th className="pb-3 px-2">Costo</th>
                <th className="pb-3 px-2 text-right">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {calls?.map((call) => {
                const isActive = !call.endedAt;
                const startDate = new Date(call.startedAt || Date.now());
                return (
                  <tr key={call.id} className="hover:bg-white/5 transition-colors">
                    <td className="py-3 px-2 text-white font-medium">{call.interpreter?.name || nameMap.get(call.interpreterId!) || 'Unknown'}</td>
                    <td className="py-3 px-2 text-gray-400 text-sm">
                      {startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </td>
                    <td className="py-3 px-2 text-gray-400 text-sm">
                      {startDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-3 px-2 text-white font-medium text-sm">
                      {call.durationSeconds ? formatDuration(call.durationSeconds) : '—'}
                    </td>
                    <td className="py-3 px-2 text-gray-400 text-sm">${Number(call.tariffSnapshot).toFixed(2)}/m</td>
                    <td className="py-3 px-2 text-green-400 font-bold text-sm">
                      {call.callCost ? `$${Number(call.callCost).toFixed(2)}` : '—'}
                    </td>
                    <td className="py-3 px-2 text-right">
                      <span className={cn(
                        'inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium',
                        isActive
                          ? 'bg-orange-500/10 text-orange-400 animate-pulse'
                          : 'bg-green-500/10 text-green-400'
                      )}>
                        {isActive ? '● Live' : '✓ Completed'}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {(!calls || calls.length === 0) && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-gray-500 italic">No se encontraron registros de llamadas.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
