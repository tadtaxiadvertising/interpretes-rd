import React from 'react';
import Link from 'next/link';
import { 
  DollarSign, 
  AlertCircle, 
  TrendingUp,
  Clock,
  CheckCircle2
} from 'lucide-react';
import prismaClient from '@/lib/prisma';
import { GeneratePayrollButton } from '@/components/GeneratePayrollButton';
import { ExportPayrollButton } from '@/components/ExportPayrollButton';
import { PayrollEngine } from '@/components/PayrollEngine';

export const dynamic = 'force-dynamic';

const prisma = prismaClient; // Regla 4: Single prisma client

// Regla 1: Next 15 Async Params
type PageProps = {
  params: Promise<{ [key: string]: string | string[] | undefined }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

async function getPayrollRecords() {
  try {
    const records = await prisma.payrollRecord.findMany({
      include: { 
        interpreter: {
          select: { name: true, metodoPago: true, cuentaPago: true, banco: true }
        } 
      },
      orderBy: { periodStart: 'desc' },
      take: 200
    });
    // Necesario para pasar props de Servidor a Cliente sin perder clases Date o Decimal
    return JSON.parse(JSON.stringify(records));
  } catch (error) {
    console.error('❌ PAYROLL: Error fetching payroll records from DB:', error);
    return [];
  }
}

export default async function PayrollPage(props: PageProps) {
  // Desempaquetado asíncrono mandatario en Next 15
  await props.params;
  await props.searchParams;

  const records = await getPayrollRecords();

  const totalPayoutLifetime = records
    .filter((r: any) => r.status === 'Paid' || r.status === 'PAID')
    .reduce((acc: number, rec: any) => acc + parseFloat(rec.netTotal?.toString() || '0'), 0);

  const pendingRecords = records.filter((r: any) => r.status === 'Draft' || r.status === 'Pendiente');
  const approvedRecords = records.filter((r: any) => r.status === 'Approved');

  const pendingPayout = pendingRecords.reduce((acc: number, rec: any) => acc + parseFloat(rec.netTotal?.toString() || '0'), 0);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tight">Motor de Nómina</h2>
          <p className="text-gray-400 mt-1 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            Gestión y verificación de nómina
          </p>
        </div>
        <div className="flex flex-wrap gap-4">
          <Link 
            href="/admin/production/manual"
            className="flex items-center gap-2 px-4 py-2 bg-slate-800/50 text-slate-300 border border-white/10 rounded-xl text-sm font-bold hover:bg-slate-800 transition-all"
          >
            <Clock size={16} /> Registrar minutos
          </Link>
          <ExportPayrollButton data={records} />
          <GeneratePayrollButton />
        </div>
      </header>

      {/* Payroll Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gradient-to-br from-indigo-900/40 to-slate-900/60 p-6 rounded-3xl border border-indigo-500/20 shadow-lg relative overflow-hidden backdrop-blur-md group">
          <div className="absolute top-0 right-0 p-16 bg-indigo-500/5 blur-[50px] rounded-full group-hover:bg-indigo-500/10 transition-all pointer-events-none" />
          <p className="text-sm text-indigo-200/70 font-bold tracking-wide uppercase">Pagos históricos</p>
          <div className="flex items-center gap-3 mt-2 relative z-10">
            <h3 className="text-4xl font-black text-white tracking-tight">
              RD${totalPayoutLifetime.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </h3>
          </div>
          <TrendingUp size={24} className="mt-4 text-indigo-400 relative z-10" />
        </div>
        
        <div className="bg-gradient-to-br from-orange-900/40 to-slate-900/60 p-6 rounded-3xl border border-orange-500/20 shadow-lg relative overflow-hidden backdrop-blur-md group">
          <div className="absolute top-0 right-0 p-16 bg-orange-500/5 blur-[50px] rounded-full group-hover:bg-orange-500/10 transition-all pointer-events-none" />
          <p className="text-sm text-orange-200/70 font-bold tracking-wide uppercase">Borradores</p>
          <div className="flex items-center gap-3 mt-2 relative z-10">
            <h3 className="text-4xl font-black text-white tracking-tight">
              {pendingRecords.length}
            </h3>
            <span className="text-xs font-bold text-orange-400 bg-orange-400/10 px-3 py-1 rounded-full border border-orange-500/20 shadow-[0_0_10px_rgba(249,115,22,0.2)]">Requiere acción</span>
          </div>
          <AlertCircle size={24} className="mt-4 text-orange-400 relative z-10" />
        </div>
        
        <div className="bg-gradient-to-br from-blue-900/40 to-slate-900/60 p-6 rounded-3xl border border-blue-500/20 shadow-lg relative overflow-hidden backdrop-blur-md group">
          <div className="absolute top-0 right-0 p-16 bg-blue-500/5 blur-[50px] rounded-full group-hover:bg-blue-500/10 transition-all pointer-events-none" />
          <p className="text-sm text-blue-200/70 font-bold tracking-wide uppercase">Listos para pagar</p>
          <div className="flex items-center gap-3 mt-2 relative z-10">
            <h3 className="text-4xl font-black text-white tracking-tight">{approvedRecords.length}</h3>
            <span className="text-xs font-bold text-blue-400 bg-blue-400/10 px-3 py-1 rounded-full border border-blue-500/20 shadow-[0_0_10px_rgba(59,130,246,0.2)]">Aprobados</span>
          </div>
          <CheckCircle2 size={24} className="mt-4 text-blue-400 relative z-10" />
        </div>
      </div>

      {/* Payroll List & Verification Engine */}
      <PayrollEngine initialRecords={records} />
      
    </div>
  );
}
