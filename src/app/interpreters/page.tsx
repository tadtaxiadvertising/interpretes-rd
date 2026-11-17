import React from 'react';
import {
  Users,
  Search,
  Filter,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AddInterpreterButton } from '@/components/AddInterpreterButton';
import { InterpreterActions } from '@/components/InterpreterActions';
import { ExportInterpretersButton } from '@/components/ExportInterpretersButton';
import { BankingInfoCard } from '@/components/admin/BankingInfoCard';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

async function getInterpreters() {
  try {
    const interpreters = await prisma.interpreter.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        externalId: true,
        name: true,
        status: true,
        realtimeStatus: true,
        campaign: true,
        languageA: true,
        languageB: true,
        tariffPerMinute: true,
        monthlyGoal: true,
        emailCorporativo: true,
        pais: true,
        metodoPago: true,
        cuentaPago: true,
        documentosCompleto: true,
        notas: true,
        banco: true,
        tipoCuenta: true,
        cedulaRnc: true,
        updatedAt: true,
        createdAt: true,
        userProfile: {
          select: {
            id: true,
            onboardingComplete: true,
          },
        },
      }
    });
    return interpreters as any[];
  } catch (error) {
    console.error('Error fetching interpreters from DB:', error);
    return [];
  }
}

export default async function InterpretersPage() {
  const interpreters = await getInterpreters();

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold text-white">Directorio de intérpretes</h2>
          <p className="text-gray-400">Consulta y administra el directorio de intérpretes.</p>
        </div>
        <div className="flex gap-4">
          <ExportInterpretersButton data={interpreters} />
          <AddInterpreterButton />
        </div>
      </header>

      {/* Filters & Search */}
      <div className="flex flex-col md:flex-row gap-4 items-center">
        <div className="flex-1 relative w-full">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
          <input
            type="text"
            placeholder="Buscar por nombre, ID o campaña..."
            className="w-full bg-slate-900/50 border border-slate-800 rounded-2xl py-3 pl-12 pr-4 text-white focus:outline-none focus:border-indigo-500/50 transition-colors backdrop-blur-sm"
          />
        </div>
        <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto pb-2 md:pb-0 hide-scrollbar">
          <button className="whitespace-nowrap px-4 py-2 bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 rounded-full text-sm font-medium transition-colors">
            All
          </button>
          <button className="whitespace-nowrap px-4 py-2 bg-slate-900/50 text-slate-300 border border-slate-800 hover:bg-slate-800 rounded-full text-sm font-medium transition-colors">
            OPI Medical
          </button>
          <button className="whitespace-nowrap px-4 py-2 bg-slate-900/50 text-slate-300 border border-slate-800 hover:bg-slate-800 rounded-full text-sm font-medium transition-colors">
            Spanish
          </button>
          <button className="flex items-center gap-2 whitespace-nowrap px-4 py-2 bg-slate-900/50 text-slate-300 border border-slate-800 hover:bg-slate-800 rounded-full text-sm font-medium transition-colors ml-auto md:ml-2">
            <Filter size={16} />
            More Filters
          </button>
        </div>
      </div>

      {/* Interpreters Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {interpreters.map((interpreter) => {
          const isActive = interpreter.status === 'Activo';
          return (
            <div key={interpreter.id} className="group bg-slate-900/40 border border-slate-800 rounded-3xl p-6 hover:bg-slate-800/50 hover:border-indigo-500/30 transition-all duration-300 relative overflow-hidden backdrop-blur-sm">
              <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                <InterpreterActions interpreter={interpreter} />
              </div>

              <div className="flex items-start gap-4 mb-4">
                <div className="relative">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center text-indigo-400 font-bold text-xl border border-white/5">
                    {interpreter.name.charAt(0)}
                  </div>
                  {isActive && (
                    <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-slate-900 rounded-full flex items-center justify-center">
                      <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                    </div>
                  )}
                </div>
                <div>
                  <h3 className="font-bold text-white text-lg group-hover:text-indigo-400 transition-colors line-clamp-1">
                    {interpreter.name}
                  </h3>
                  <p className="text-sm text-slate-500 flex items-center gap-1 font-mono">
                    ID: {interpreter.externalId}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">Estado</span>
                  <span className={cn(
                    "px-3 py-1 rounded-full text-xs font-bold",
                    isActive ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                      interpreter.status === 'Probation' ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" :
                        "bg-slate-500/10 text-slate-400 border border-slate-500/20"
                  )}>
                    {interpreter.status}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">Campaña</span>
                  <span className="text-sm text-slate-300 font-medium truncate max-w-[120px] text-right">
                    {interpreter.campaign || 'Unassigned'}
                  </span>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-slate-800/50">
                  <div className="flex flex-col">
                    <span className="text-xs text-slate-500 font-bold uppercase tracking-tighter">Tarifa</span>
                    <p className="text-white font-mono font-bold">RD${(parseFloat(interpreter.tariffPerMinute.toString()) * 60).toFixed(2)}<span className="text-xs text-slate-500">/h</span></p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-slate-500 font-bold uppercase tracking-tighter">Meta</span>
                    <p className="text-indigo-400 font-mono font-bold">{Math.round((interpreter.monthlyGoal || 2000) / 60)}h<span className="text-xs text-slate-500">/mes</span></p>
                  </div>
                </div>

                {/* Payroll / Banking Info */}
                {interpreter.userProfile?.id && (
                  <BankingInfoCard
                    userId={interpreter.userProfile.id}
                    bankName={interpreter.banco}
                    bankAccount={interpreter.cuentaPago}
                    bankAccountType={interpreter.tipoCuenta}
                    bankCedula={interpreter.cedulaRnc}
                    onboardingComplete={interpreter.documentosCompleto}
                    compact
                  />
                )}

                {/* Fixed Action Button */}
                <div className="pt-2">
                  <AddInterpreterButton
                    label="Ajustar Meta y Perfil"
                    mode="edit"
                    initialData={interpreter}
                  />
                </div>
              </div>
            </div>
          );
        })}

        {interpreters.length === 0 && (
          <div className="col-span-full p-20 text-center bg-slate-900/20 border border-slate-800 rounded-3xl border-dashed">
            <Users size={48} className="mx-auto text-slate-700 mb-4" />
            <p className="text-slate-500 font-medium">No se encontraron intérpretes.</p>
          </div>
        )}
      </div>
    </div>
  );
}
