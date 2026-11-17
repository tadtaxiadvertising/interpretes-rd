'use client';

import React, { useState, useActionState, useMemo } from 'react';
import { useFormStatus } from 'react-dom';
import { Search, DollarSign, CheckCircle2, AlertTriangle, Loader2, Edit3, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isApprovedPayrollStatus, isEditablePayrollStatus, isPaidPayrollStatus } from '@/lib/payroll-validation';
import { updatePayrollAdjustments, verifyPayrollMinutes, markPayrollAsPaid } from '@/app/actions/payroll.actions';

function SubmitButton({ label, loadingLabel }: { label: string, loadingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        "w-full py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2",
        pending
          ? "bg-slate-800 text-slate-500 cursor-not-allowed" 
          : "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20"
      )}
    >
      {pending ? <><Loader2 className="animate-spin" size={18} /> {loadingLabel}</> : label}
    </button>
  );
}

export function PayrollEngine({ initialRecords }: { initialRecords: any[] }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'Draft' | 'Approved' | 'Paid'>('ALL');
  
  // Modal States
  const [activeModal, setActiveModal] = useState<'NONE' | 'ADJUST' | 'VERIFY' | 'PAY'>('NONE');
  const [selectedRecord, setSelectedRecord] = useState<any>(null);

  // Handlers para abrir modales
  const openModal = (type: 'ADJUST' | 'VERIFY' | 'PAY', record: any) => {
    setSelectedRecord(record);
    setActiveModal(type);
  };
  const closeModal = () => {
    setActiveModal('NONE');
    setSelectedRecord(null);
  };

  // Filtrado de la tabla
  const filteredRecords = useMemo(() => {
    return initialRecords.filter(r => {
      const matchSearch = (r.interpreter?.name || '').toLowerCase().includes(searchTerm.toLowerCase());
      
      // Normalizar status DB: 'Pendiente' / 'Draft' -> 'Draft'
      const normStatus = isPaidPayrollStatus(r.status) ? 'Paid' :
        isApprovedPayrollStatus(r.status) ? 'Approved' :
        isEditablePayrollStatus(r.status) ? 'Draft' : 'Other';
      
      const matchStatus = filterStatus === 'ALL' || normStatus === filterStatus;
      
      return matchSearch && matchStatus;
    });
  }, [initialRecords, searchTerm, filterStatus]);

  // Action States para Modales
  const [adjustState, adjustAction] = useActionState(updatePayrollAdjustments, null);
  const [verifyState, verifyAction] = useActionState(verifyPayrollMinutes, null);
  const [payState, payAction] = useActionState(markPayrollAsPaid, null);

  // Auto-cierre de modales en success (simplificado para UX)
  React.useEffect(() => {
    if (!adjustState?.success && !verifyState?.success && !payState?.success) return;
    const timeoutId = setTimeout(() => closeModal(), 1500);
    return () => clearTimeout(timeoutId);
  }, [adjustState, verifyState, payState]);

  return (
    <div className="space-y-6">
      {/* Barra de Búsqueda y Filtros */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between glass p-4 rounded-2xl border border-white/5">
        <div className="relative w-full md:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
          <input 
            type="text"
            placeholder="Buscar intérprete..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-900/50 border border-white/10 rounded-xl py-2 pl-10 pr-4 text-white focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>
        <div className="flex gap-2">
          {['ALL', 'Draft', 'Approved', 'Paid'].map(status => (
            <button
              key={status}
              onClick={() => setFilterStatus(status as any)}
              className={cn(
                "px-4 py-2 rounded-xl text-sm font-bold transition-all",
                filterStatus === status 
                  ? "bg-white/10 text-white border border-white/20" 
                  : "bg-transparent text-gray-500 hover:text-gray-300 border border-transparent hover:bg-white/5"
              )}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {/* Tabla Transaccional */}
      <div className="glass rounded-3xl overflow-hidden border border-white/5 bg-slate-900/40">
        {/* Mobile View (Cards) */}
        <div className="grid grid-cols-1 gap-4 p-4 md:hidden">
          {filteredRecords.length === 0 ? (
            <div className="py-8 text-center text-gray-500">No se encontraron registros.</div>
          ) : filteredRecords.map(record => {
            const isPaid = isPaidPayrollStatus(record.status);
            const isApproved = isApprovedPayrollStatus(record.status);
            const isEditable = isEditablePayrollStatus(record.status);
            
            return (
              <div key={record.id} className="bg-slate-800/50 rounded-2xl p-4 border border-white/5 space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-bold text-white text-sm">{record.interpreter?.name || 'Desconocido'}</p>
                    <p className="text-[10px] text-gray-500 font-mono">{record.interpreter?.metodoPago}</p>
                  </div>
                  <span className={cn(
                    "px-2 py-1 rounded-lg text-[10px] font-black uppercase border",
                    isPaid ? "bg-green-500/10 text-green-400 border-green-500/20" :
                    isApproved ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
                    "bg-orange-500/10 text-orange-400 border-orange-500/20"
                  )}>
                    {isPaid ? 'PAGADO' : isApproved ? 'APROBADO' : isEditable ? 'PENDIENTE' : 'ESTADO POR REVISAR'}
                  </span>
                </div>
                
                <div className="grid grid-cols-2 gap-2 text-sm pt-2 border-t border-white/5">
                  <div>
                    <p className="text-xs text-gray-500">Período</p>
                    <p className="text-gray-300 text-[10px]">{new Date(record.periodStart).toLocaleDateString()} - {new Date(record.periodEnd).toLocaleDateString()}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Minutos</p>
                    <div className="flex items-center gap-1">
                      <p className="text-white">{record.verifiedMinutes || record.totalMinutes}</p>
                      {record.verifiedMinutes ? <span className="text-[9px] text-emerald-400 font-bold uppercase">Verificado</span> : <span className="text-[9px] text-orange-400 font-bold uppercase">Reportado</span>}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-white/5">
                  <div>
                    <p className="text-xs text-gray-500">Neto (RD$)</p>
                    <p className="text-sm font-bold text-green-400">RD${Number(record.netTotal).toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {isEditable && !isPaid && (
                      <>
                        <button onClick={() => openModal('ADJUST', record)} className="p-2 bg-white/5 hover:bg-white/10 rounded-md text-gray-400 transition-colors" title="Ajustes">
                          <Edit3 size={16} />
                        </button>
                        <button onClick={() => openModal('VERIFY', record)} className="p-2 bg-blue-500/10 hover:bg-blue-500/20 rounded-md text-blue-400 transition-colors" title="Verificar Minutos">
                          <ShieldCheck size={16} />
                        </button>
                      </>
                    )}
                    {isApproved && !isPaid && (
                      <button onClick={() => openModal('PAY', record)} className="p-2 bg-green-500/10 hover:bg-green-500/20 rounded-md text-green-400 transition-colors" title="Marcar Pagado">
                        <DollarSign size={16} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="overflow-x-auto hidden md:block">
          <table className="w-full text-left">
            <thead className="bg-white/[0.02] text-gray-400 text-xs uppercase tracking-wider">
              <tr>
                <th className="py-4 px-6 font-semibold">Intérprete</th>
                <th className="py-4 px-4 font-semibold">Período</th>
                <th className="py-4 px-4 font-semibold">Minutos</th>
                <th className="py-4 px-4 font-semibold text-right">Neto (RD$)</th>
                <th className="py-4 px-4 font-semibold">Estado</th>
                <th className="py-4 px-6 font-semibold text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredRecords.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-gray-500">No se encontraron registros.</td></tr>
              ) : filteredRecords.map(record => {
                const isPaid = isPaidPayrollStatus(record.status);
                const isApproved = isApprovedPayrollStatus(record.status);
                const isEditable = isEditablePayrollStatus(record.status);
                
                return (
                  <tr key={record.id} className="hover:bg-white/5 transition-colors">
                    <td className="py-4 px-6">
                      <p className="font-bold text-white text-sm">{record.interpreter?.name || 'Desconocido'}</p>
                      <p className="text-[10px] text-gray-500 font-mono">Pago: {record.interpreter?.metodoPago}</p>
                    </td>
                    <td className="py-4 px-4 text-xs text-gray-400">
                      {new Date(record.periodStart).toLocaleDateString()} - {new Date(record.periodEnd).toLocaleDateString()}
                    </td>
                    <td className="py-4 px-4">
                      <p className="text-sm text-white">{record.verifiedMinutes || record.totalMinutes}</p>
                      {record.verifiedMinutes ? <span className="text-[9px] text-emerald-400 font-bold uppercase">Verificado</span> : <span className="text-[9px] text-orange-400 font-bold uppercase">Reportado</span>}
                    </td>
                    <td className="py-4 px-4 text-right">
                      <p className="text-sm font-bold text-green-400">RD${Number(record.netTotal).toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                    </td>
                    <td className="py-4 px-4">
                      <span className={cn(
                        "px-2 py-1 rounded-lg text-[10px] font-black uppercase border",
                        isPaid ? "bg-green-500/10 text-green-400 border-green-500/20" :
                        isApproved ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
                        "bg-orange-500/10 text-orange-400 border-orange-500/20"
                      )}>
                        {isPaid ? 'PAGADO' : isApproved ? 'APROBADO' : isEditable ? 'PENDIENTE' : 'ESTADO POR REVISAR'}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-center">
                      <div className="flex items-center justify-center gap-2">
                        {isEditable && !isPaid && (
                          <>
                            <button onClick={() => openModal('ADJUST', record)} className="p-1.5 bg-white/5 hover:bg-white/10 rounded-md text-gray-400 transition-colors" title="Ajustes">
                              <Edit3 size={14} />
                            </button>
                            <button onClick={() => openModal('VERIFY', record)} className="p-1.5 bg-blue-500/10 hover:bg-blue-500/20 rounded-md text-blue-400 transition-colors" title="Verificar Minutos">
                              <ShieldCheck size={14} />
                            </button>
                          </>
                        )}
                        {isApproved && !isPaid && (
                          <button onClick={() => openModal('PAY', record)} className="p-1.5 bg-green-500/10 hover:bg-green-500/20 rounded-md text-green-400 transition-colors" title="Marcar Pagado">
                            <DollarSign size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* --- MODAL: AJUSTES --- */}
      {activeModal === 'ADJUST' && selectedRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-white/10 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-6">
              <h3 className="text-xl font-bold text-white mb-2">Ajustes de Nómina</h3>
              <p className="text-sm text-gray-400 mb-6">{selectedRecord.interpreter?.name}</p>
              
              <form action={adjustAction} className="space-y-4">
                <input type="hidden" name="id" value={selectedRecord.id} />
                
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-1 uppercase tracking-wider">Incentivos Adicionales (RD$)</label>
                  <input type="number" step="0.01" name="incentives" defaultValue={selectedRecord.incentivesTotal || 0} className="w-full bg-slate-950 border border-white/10 rounded-xl py-3 px-4 text-white focus:border-blue-500 transition-colors" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-1 uppercase tracking-wider">Penalidades (RD$)</label>
                  <input type="number" step="0.01" name="penalties" defaultValue={selectedRecord.penalidades || 0} className="w-full bg-slate-950 border border-white/10 rounded-xl py-3 px-4 text-white focus:border-red-500 transition-colors" />
                </div>

                {adjustState?.error && <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400">{adjustState.error}</div>}
                {adjustState?.success && <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-xl text-xs text-green-400">{adjustState.message}</div>}

                <div className="flex gap-3 pt-4">
                  <button type="button" onClick={closeModal} className="flex-1 py-3 rounded-xl font-bold bg-white/5 hover:bg-white/10 text-white transition-all">Cancelar</button>
                  <div className="flex-1">
                    <SubmitButton label="Guardar" loadingLabel="Guardando" />
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL: VERIFICACIÓN --- */}
      {activeModal === 'VERIFY' && selectedRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-white/10 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-6">
              <h3 className="text-xl font-bold text-white mb-2">Verificar Producción</h3>
              <p className="text-sm text-gray-400 mb-6">Confirma los minutos auditados para aprobar la nómina de {selectedRecord.interpreter?.name}.</p>
              
              <form action={verifyAction} className="space-y-4">
                <input type="hidden" name="id" value={selectedRecord.id} />
                
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-1 uppercase tracking-wider">Minutos Finales Verificados</label>
                  <input type="number" name="verifiedMinutes" required defaultValue={selectedRecord.verifiedMinutes || selectedRecord.totalMinutes} className="w-full bg-slate-950 border border-white/10 rounded-xl py-3 px-4 text-white focus:border-blue-500 transition-colors font-mono text-xl" />
                </div>

                {verifyState?.error && <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400 flex items-center gap-2"><AlertTriangle size={14}/> {verifyState.error}</div>}
                {verifyState?.success && <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-xl text-xs text-green-400 flex items-center gap-2"><CheckCircle2 size={14}/> {verifyState.message}</div>}

                <div className="flex gap-3 pt-4">
                  <button type="button" onClick={closeModal} className="flex-1 py-3 rounded-xl font-bold bg-white/5 hover:bg-white/10 text-white transition-all">Cancelar</button>
                  <div className="flex-1">
                    <SubmitButton label="Aprobar Nómina" loadingLabel="Aprobando" />
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL: PAGAR --- */}
      {activeModal === 'PAY' && selectedRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-white/10 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-6">
              <div className="w-12 h-12 bg-green-500/10 rounded-2xl flex items-center justify-center text-green-400 mb-4 border border-green-500/20">
                 <DollarSign size={24} />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Desembolsar Pago</h3>
              <p className="text-sm text-gray-400 mb-6">Monto a depositar: <strong className="text-green-400">RD${Number(selectedRecord.netTotal).toLocaleString()}</strong> a {selectedRecord.interpreter?.name}.</p>
              
              <div className="mb-6 p-4 bg-white/5 border border-white/10 rounded-xl text-sm">
                <p className="text-gray-400">Método: <span className="text-white font-bold">{selectedRecord.interpreter?.metodoPago}</span></p>
                <p className="text-gray-400">Cuenta/Banco: <span className="text-white">{selectedRecord.interpreter?.cuentaPago} - {selectedRecord.interpreter?.banco}</span></p>
              </div>

              <form action={payAction} className="space-y-4">
                <input type="hidden" name="id" value={selectedRecord.id} />
                
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-1 uppercase tracking-wider">Referencia de Transacción (Banco)</label>
                  <input type="text" name="transactionReference" required placeholder="Ej. BHD-8849201" className="w-full bg-slate-950 border border-white/10 rounded-xl py-3 px-4 text-white focus:border-green-500 transition-colors font-mono" />
                </div>

                {payState?.error && <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400 flex items-center gap-2"><AlertTriangle size={14}/> {payState.error}</div>}
                {payState?.success && <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-xl text-xs text-green-400 flex items-center gap-2"><CheckCircle2 size={14}/> {payState.message}</div>}

                <div className="flex gap-3 pt-4">
                  <button type="button" onClick={closeModal} className="flex-1 py-3 rounded-xl font-bold bg-white/5 hover:bg-white/10 text-white transition-all">Cancelar</button>
                  <div className="flex-1">
                    <SubmitButton label="Confirmar Pago" loadingLabel="Procesando" />
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
