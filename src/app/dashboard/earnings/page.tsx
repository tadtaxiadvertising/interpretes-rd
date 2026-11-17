import React from 'react';
import { getCurrentUser } from '@/lib/auth/actions';
import { redirect } from 'next/navigation';
import { 
  DollarSign, 
  TrendingUp, 
  Clock, 
  Calendar, 
  FileText, 
  Download,
  AlertCircle
} from 'lucide-react';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

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
      <div className="p-12 glass rounded-3xl border border-white/5 text-center">
        <AlertCircle size={48} className="mx-auto text-yellow-500 mb-4" />
        <h3 className="text-xl font-bold text-white">Perfil no vinculado</h3>
        <p className="text-gray-400 mt-2">Tu cuenta todavía no está vinculada a un perfil de intérprete. Contacta con soporte para recibir ayuda.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <header>
        <h2 className="text-3xl font-bold text-white flex items-center gap-3">
          <DollarSign className="text-green-400" />
          Earnings & Payments
        </h2>
        <p className="text-gray-400 mt-2">Consulta tus ingresos, tarifas e historial de pagos.</p>
      </header>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass p-6 rounded-3xl border border-white/5 bg-gradient-to-br from-green-500/5 to-transparent">
          <p className="text-sm text-gray-500 font-medium">Tu tarifa base</p>
          <div className="flex items-center gap-3 mt-2">
            <h3 className="text-3xl font-bold text-white">RD${(Number(interpreter.tariffPerMinute) * 60).toFixed(2)}</h3>
            <span className="text-xs text-gray-400">por hora de interpretación</span>
          </div>
          <TrendingUp size={24} className="mt-4 text-green-500" />
        </div>

        <div className="glass p-6 rounded-3xl border border-white/5">
          <p className="text-sm text-gray-500 font-medium">Último pago</p>
          <div className="flex items-center gap-3 mt-2">
            <h3 className="text-3xl font-bold text-white">
              {interpreter.payrollRecords[0] ? `RD$${interpreter.payrollRecords[0].netTotal.toString()}` : 'RD$0.00'}
            </h3>
          </div>
          <Calendar size={24} className="mt-4 text-blue-400" />
        </div>

        <div className="glass p-6 rounded-3xl border border-white/5">
          <p className="text-sm text-gray-500 font-medium">Método preferido</p>
          <div className="flex items-center gap-3 mt-2">
            <h3 className="text-xl font-bold text-white">{interpreter.metodoPago || 'No configurado'}</h3>
          </div>
          <div className="mt-4 text-xs text-gray-500 truncate">{interpreter.cuentaPago || 'Add your payment details in Settings'}</div>
        </div>
      </div>

      {/* Historial de pagos */}
      <div className="glass rounded-3xl overflow-hidden border border-white/5">
        <div className="p-6 border-b border-white/5">
          <h3 className="text-xl font-bold text-white">Historial de pagos</h3>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-white/5 text-gray-400 text-xs uppercase tracking-wider">
                <th className="p-6">Período</th>
                <th className="p-6">Horas</th>
                <th className="p-6">Bruto</th>
                <th className="p-6">Bonificaciones / Deducciones</th>
                <th className="p-6">Total neto</th>
                <th className="p-6">Estado</th>
                <th className="p-6 text-right">Comprobante</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {interpreter.payrollRecords.map((record) => (
                <tr key={record.id} className="hover:bg-white/5 transition-colors">
                  <td className="p-6">
                    <div className="text-white font-medium">
                      {new Date(record.periodStart).toLocaleDateString()} - {new Date(record.periodEnd).toLocaleDateString()}
                    </div>
                  </td>
                  <td className="p-6 text-gray-400">{(record.totalMinutes / 60).toFixed(2)}h</td>
                  <td className="p-6 text-gray-400">RD${record.grossTotal.toString()}</td>
                  <td className="p-6">
                    <span className="text-green-400 text-xs">+RD$${(record.qualityBonus || 0).toString()}</span>
                    <span className="text-red-400 text-xs ml-2">-RD$${(record.penalidades || 0).toString()}</span>
                  </td>
                  <td className="p-6 text-white font-bold">RD${record.netTotal.toString()}</td>
                  <td className="p-6">
                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                      record.status === 'Pagado' ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400'
                    }`}>
                      {record.status}
                    </span>
                  </td>
                  <td className="p-6 text-right">
                    <button className="p-2 bg-white/5 rounded-xl text-gray-400 hover:text-white transition-all">
                      <Download size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          
          {interpreter.payrollRecords.length === 0 && (
            <div className="p-20 text-center text-gray-500">
              <FileText size={48} className="mx-auto mb-4 opacity-20" />
              <p>Todavía no hay registros de pagos.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
