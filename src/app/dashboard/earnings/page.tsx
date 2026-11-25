import React from 'react';
import { getCurrentUser } from '@/lib/auth/actions';
import { redirect } from 'next/navigation';
import { 
  DollarSign, 
  TrendingUp, 
  Clock, 
  Calendar, 
  FileText, 
  AlertCircle
} from 'lucide-react';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

function maskAccount(account: string | null | undefined): string {
  if (!account) return 'No configurada';
  return `•••• ${account.slice(-4)}`;
}

export default async function EarningsPage() {
  const userData = await getCurrentUser();

  if (!userData) redirect('/login');

  const user = userData;

  // Fetch the interpreter profile linked to this user
  const interpreter = await prisma.interpreter.findFirst({
    where: { emailCorporativo: user.email },
    select: {
      id: true,
      name: true,
      tariffPerMinute: true,
      metodoPago: true,
      cuentaPago: true,
      payrollRecords: {
        orderBy: { periodStart: 'desc' },
        take: 12
      }
    }
  });

  if (!interpreter) {
    return (
      <div className="p-12 glass rounded-3xl border border-[var(--border)] text-center">
        <AlertCircle size={48} className="mx-auto text-[var(--theme-warning)] mb-4" />
        <h3 className="text-xl font-bold text-[var(--foreground)]">Perfil no vinculado</h3>
        <p className="text-[var(--text-secondary)] mt-2">Tu cuenta todavía no está vinculada a un perfil de intérprete. Contacta con soporte para recibir ayuda.</p>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-8 animate-in fade-in duration-700">
      <header>
        <h2 className="text-3xl font-bold text-[var(--foreground)] flex items-center gap-3">
          <DollarSign className="text-[var(--theme-success)]" />
          Ingresos y pagos
        </h2>
        <p className="text-[var(--text-secondary)] mt-2">Consulta tus ingresos, tarifas e historial de pagos.</p>
      </header>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass p-6 rounded-3xl border border-[var(--border)] bg-gradient-to-br from-green-500/5 to-transparent">
          <p className="text-sm text-[var(--text-tertiary)] font-medium">Tu tarifa base</p>
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <h3 className="break-all text-2xl sm:text-3xl font-bold text-[var(--foreground)]">RD${(Number(interpreter.tariffPerMinute) * 60).toFixed(2)}</h3>
            <span className="text-xs text-[var(--text-secondary)]">por hora de interpretación</span>
          </div>
          <TrendingUp size={24} className="mt-4 text-[var(--theme-success)]" />
        </div>

        <div className="glass p-6 rounded-3xl border border-[var(--border)]">
          <p className="text-sm text-[var(--text-tertiary)] font-medium">Último pago</p>
          <div className="flex items-center gap-3 mt-2">
            <h3 className="text-3xl font-bold text-[var(--foreground)]">
              {interpreter.payrollRecords[0] ? `RD$${interpreter.payrollRecords[0].netTotal.toString()}` : 'RD$0.00'}
            </h3>
          </div>
          <Calendar size={24} className="mt-4 text-[var(--theme-link)]" />
        </div>

        <div className="glass p-6 rounded-3xl border border-[var(--border)]">
          <p className="text-sm text-[var(--text-tertiary)] font-medium">Método preferido</p>
          <div className="flex items-center gap-3 mt-2">
            <h3 className="text-xl font-bold text-[var(--foreground)]">{interpreter.metodoPago || 'No configurado'}</h3>
          </div>
          <div className="mt-4 text-xs text-[var(--text-tertiary)] truncate">{maskAccount(interpreter.cuentaPago)}</div>
        </div>
      </div>

      {/* Historial de pagos */}
      <div className="glass rounded-3xl overflow-hidden border border-[var(--border)]">
        <div className="p-6 border-b border-[var(--border)]">
          <h3 className="text-xl font-bold text-[var(--foreground)]">Historial de pagos</h3>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-[var(--theme-surface-muted)] text-[var(--text-secondary)] text-xs uppercase tracking-wider">
                <th className="p-6">Período</th>
                <th className="p-6">Horas</th>
                <th className="p-6">Bruto</th>
                <th className="p-6">Bonificaciones / Deducciones</th>
                <th className="p-6">Total neto</th>
                <th className="p-6">Estado</th>
                <th className="p-6 text-right">Referencia</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {interpreter.payrollRecords.map((record) => (
                <tr key={record.id} className="hover:bg-[var(--theme-hover)] transition-colors">
                  <td className="p-6">
                    <div className="text-[var(--foreground)] font-medium">
                      {new Date(record.periodStart).toLocaleDateString()} - {new Date(record.periodEnd).toLocaleDateString()}
                    </div>
                  </td>
                  <td className="p-6 text-[var(--text-secondary)]">{(record.totalMinutes / 60).toFixed(2)}h</td>
                  <td className="p-6 text-[var(--text-secondary)]">RD${record.grossTotal.toString()}</td>
                  <td className="p-6">
                    <span className="text-[var(--theme-success)] text-xs">+RD${(record.qualityBonus || 0).toString()}</span>
                    <span className="text-[var(--theme-danger)] text-xs ml-2">-RD${(record.penalidades || 0).toString()}</span>
                  </td>
                  <td className="p-6 text-[var(--foreground)] font-bold">RD${record.netTotal.toString()}</td>
                  <td className="p-6">
                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                      record.status === 'Pagado' ? 'bg-green-500/10 text-[var(--theme-success)]' : 'bg-yellow-500/10 text-[var(--theme-warning)]'
                    }`}>
                      {record.status}
                    </span>
                  </td>
                  <td className="p-6 text-right">
                    <span className="text-xs text-[var(--text-secondary)] font-mono">
                      {record.transactionReference || '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          
          {interpreter.payrollRecords.length === 0 && (
            <div className="p-20 text-center text-[var(--text-tertiary)]">
              <FileText size={48} className="mx-auto mb-4 opacity-20" />
              <p>Todavía no hay registros de pagos.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
