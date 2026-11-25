'use client';

import React, { useState, useActionState, useMemo } from 'react';
import { useFormStatus } from 'react-dom';
import { Search, DollarSign, CheckCircle2, AlertTriangle, Loader2, Edit3, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Modal } from '@/components/Modal';
import { isApprovedPayrollStatus, isEditablePayrollStatus, isPaidPayrollStatus } from '@/lib/payroll-validation';
import { updatePayrollAdjustments, verifyPayrollMinutes, markPayrollAsPaid } from '@/app/actions/payroll.actions';

function SubmitButton({ label, loadingLabel }: { label: string, loadingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="theme-action-primary w-full py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2"
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
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between glass p-4 rounded-2xl border border-[var(--border)]">
        <div className="relative w-full md:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={18} />
          <input 
            type="text"
            aria-label="Buscar intérprete en nómina"
            placeholder="Buscar intérprete..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-[var(--theme-control-bg)] border border-[var(--theme-control-border)] rounded-xl py-2 pl-10 pr-4 text-[var(--theme-control-text)] focus:outline-none focus:border-[var(--theme-focus)] transition-colors"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {['ALL', 'Draft', 'Approved', 'Paid'].map(status => (
            <button
              key={status}
              aria-pressed={filterStatus === status}
              onClick={() => setFilterStatus(status as any)}
              className={cn(
                "px-4 py-2 rounded-xl text-sm font-bold transition-all",
                filterStatus === status 
                  ? "theme-action-primary" 
                  : "theme-action-secondary"
              )}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {/* Tabla Transaccional */}
      <div className="glass rounded-3xl overflow-hidden border border-[var(--border)] bg-[var(--theme-panel)]">
        {/* Mobile View (Cards) */}
        <div className="grid grid-cols-1 gap-4 p-4 md:hidden">
          {filteredRecords.length === 0 ? (
            <div className="py-8 text-center text-[var(--text-tertiary)]">No se encontraron registros.</div>
          ) : filteredRecords.map(record => {
            const isPaid = isPaidPayrollStatus(record.status);
            const isApproved = isApprovedPayrollStatus(record.status);
            const isEditable = isEditablePayrollStatus(record.status);
            
            return (
              <div key={record.id} className="bg-[var(--theme-surface-muted)] rounded-2xl p-4 border border-[var(--border)] space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-bold text-[var(--foreground)] text-sm">{record.interpreter?.name || 'Desconocido'}</p>
                    <p className="text-[10px] text-[var(--text-tertiary)] font-mono">{record.interpreter?.metodoPago}</p>
                  </div>
                  <span className={cn(
                    "px-2 py-1 rounded-lg text-[10px] font-black uppercase border",
                    isPaid ? "bg-green-500/10 text-[var(--theme-success)] border-green-500/20" :
                    isApproved ? "bg-blue-500/10 text-[var(--theme-link)] border-blue-500/20" :
                    "bg-orange-500/10 text-[var(--theme-away)] border-orange-500/20"
                  )}>
                    {isPaid ? 'PAGADO' : isApproved ? 'APROBADO' : isEditable ? 'PENDIENTE' : 'ESTADO POR REVISAR'}
                  </span>
                </div>
                
                <div className="grid grid-cols-2 gap-2 text-sm pt-2 border-t border-[var(--border)]">
                  <div>
                    <p className="text-xs text-[var(--text-tertiary)]">Período</p>
                    <p className="text-[var(--text-secondary)] text-[10px]">{new Date(record.periodStart).toLocaleDateString()} - {new Date(record.periodEnd).toLocaleDateString()}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--text-tertiary)]">Minutos</p>
                    <div className="flex items-center gap-1">
                      <p className="text-[var(--foreground)]">{record.verifiedMinutes || record.totalMinutes}</p>
                      {record.verifiedMinutes ? <span className="text-[9px] text-[var(--theme-success)] font-bold uppercase">Verificado</span> : <span className="text-[9px] text-[var(--theme-away)] font-bold uppercase">Reportado</span>}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-[var(--border)]">
                  <div>
                    <p className="text-xs text-[var(--text-tertiary)]">Neto (RD$)</p>
                    <p className="text-sm font-bold text-[var(--theme-success)]">RD${Number(record.netTotal).toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {isEditable && !isPaid && (
                      <>
                        <button onClick={() => openModal('ADJUST', record)} className="p-2 bg-[var(--theme-surface-muted)] hover:bg-[var(--theme-hover)] rounded-md text-[var(--text-secondary)] transition-colors" title="Ajustes">
                          <Edit3 size={16} />
                        </button>
                        <button onClick={() => openModal('VERIFY', record)} className="p-2 bg-blue-500/10 hover:bg-blue-500/20 rounded-md text-[var(--theme-link)] transition-colors" title="Verificar Minutos">
                          <ShieldCheck size={16} />
                        </button>
                      </>
                    )}
                    {isApproved && !isPaid && (
                      <button onClick={() => openModal('PAY', record)} className="p-2 bg-green-500/10 hover:bg-green-500/20 rounded-md text-[var(--theme-success)] transition-colors" title="Marcar Pagado">
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
            <thead className="bg-[var(--theme-surface-muted)] text-[var(--text-secondary)] text-xs uppercase tracking-wider">
              <tr>
                <th className="py-4 px-6 font-semibold">Intérprete</th>
                <th className="py-4 px-4 font-semibold">Período</th>
                <th className="py-4 px-4 font-semibold">Minutos</th>
                <th className="py-4 px-4 font-semibold text-right">Neto (RD$)</th>
                <th className="py-4 px-4 font-semibold">Estado</th>
                <th className="py-4 px-6 font-semibold text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {filteredRecords.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-[var(--text-tertiary)]">No se encontraron registros.</td></tr>
              ) : filteredRecords.map(record => {
                const isPaid = isPaidPayrollStatus(record.status);
                const isApproved = isApprovedPayrollStatus(record.status);
                const isEditable = isEditablePayrollStatus(record.status);
                
                return (
                  <tr key={record.id} className="hover:bg-[var(--theme-hover)] transition-colors">
                    <td className="py-4 px-6">
                      <p className="font-bold text-[var(--foreground)] text-sm">{record.interpreter?.name || 'Desconocido'}</p>
                      <p className="text-[10px] text-[var(--text-tertiary)] font-mono">Pago: {record.interpreter?.metodoPago}</p>
                    </td>
                    <td className="py-4 px-4 text-xs text-[var(--text-secondary)]">
                      {new Date(record.periodStart).toLocaleDateString()} - {new Date(record.periodEnd).toLocaleDateString()}
                    </td>
                    <td className="py-4 px-4">
                      <p className="text-sm text-[var(--foreground)]">{record.verifiedMinutes || record.totalMinutes}</p>
                      {record.verifiedMinutes ? <span className="text-[9px] text-[var(--theme-success)] font-bold uppercase">Verificado</span> : <span className="text-[9px] text-[var(--theme-away)] font-bold uppercase">Reportado</span>}
                    </td>
                    <td className="py-4 px-4 text-right">
                      <p className="text-sm font-bold text-[var(--theme-success)]">RD${Number(record.netTotal).toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                    </td>
                    <td className="py-4 px-4">
                      <span className={cn(
                        "px-2 py-1 rounded-lg text-[10px] font-black uppercase border",
                        isPaid ? "bg-green-500/10 text-[var(--theme-success)] border-green-500/20" :
                        isApproved ? "bg-blue-500/10 text-[var(--theme-link)] border-blue-500/20" :
                        "bg-orange-500/10 text-[var(--theme-away)] border-orange-500/20"
                      )}>
                        {isPaid ? 'PAGADO' : isApproved ? 'APROBADO' : isEditable ? 'PENDIENTE' : 'ESTADO POR REVISAR'}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-center">
                      <div className="flex items-center justify-center gap-2">
                        {isEditable && !isPaid && (
                          <>
                            <button onClick={() => openModal('ADJUST', record)} className="p-1.5 bg-[var(--theme-surface-muted)] hover:bg-[var(--theme-hover)] rounded-md text-[var(--text-secondary)] transition-colors" title="Ajustes">
                              <Edit3 size={14} />
                            </button>
                            <button onClick={() => openModal('VERIFY', record)} className="p-1.5 bg-blue-500/10 hover:bg-blue-500/20 rounded-md text-[var(--theme-link)] transition-colors" title="Verificar Minutos">
                              <ShieldCheck size={14} />
                            </button>
                          </>
                        )}
                        {isApproved && !isPaid && (
                          <button onClick={() => openModal('PAY', record)} className="p-1.5 bg-green-500/10 hover:bg-green-500/20 rounded-md text-[var(--theme-success)] transition-colors" title="Marcar Pagado">
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
      {selectedRecord && activeModal === 'ADJUST' && (
        <Modal isOpen onClose={closeModal} title="Ajustes de Nómina" maxWidth="max-w-md">
        <p className="text-sm text-[var(--text-secondary)] mb-6">{selectedRecord.interpreter?.name}</p>
        
        <form action={adjustAction} className="space-y-4">
          <input type="hidden" name="id" value={selectedRecord.id} />
          
          <div>
            <label htmlFor="payroll-incentives" className="block text-xs font-bold text-[var(--text-secondary)] mb-1 uppercase tracking-wider">Incentivos Adicionales (RD$)</label>
            <input type="number" step="0.01" id="payroll-incentives" name="incentives" defaultValue={selectedRecord.incentivesTotal || 0} className="w-full bg-[var(--theme-control-bg)] border border-[var(--theme-control-border)] rounded-xl py-3 px-4 text-[var(--theme-control-text)] focus:border-[var(--theme-focus)] transition-colors" />
          </div>
          <div>
            <label htmlFor="payroll-penalties" className="block text-xs font-bold text-[var(--text-secondary)] mb-1 uppercase tracking-wider">Penalidades (RD$)</label>
            <input type="number" step="0.01" id="payroll-penalties" name="penalties" defaultValue={selectedRecord.penalidades || 0} className="w-full bg-[var(--theme-control-bg)] border border-[var(--theme-control-border)] rounded-xl py-3 px-4 text-[var(--theme-control-text)] focus:border-[var(--theme-focus)] transition-colors" />
          </div>

          {adjustState?.error && <div role="alert" className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-[var(--theme-danger)]">{adjustState.error}</div>}
          {adjustState?.success && <div role="status" className="p-3 bg-green-500/10 border border-green-500/20 rounded-xl text-xs text-[var(--theme-success)]">{adjustState.message}</div>}

          <div className="flex gap-3 pt-4">
            <button type="button" onClick={closeModal} className="flex-1 py-3 rounded-xl font-bold theme-action-secondary transition-all">Cancelar</button>
            <div className="flex-1">
              <SubmitButton label="Guardar" loadingLabel="Guardando" />
            </div>
          </div>
        </form>
        </Modal>
      )}

      {/* --- MODAL: VERIFICACIÓN --- */}
      {selectedRecord && activeModal === 'VERIFY' && (
        <Modal isOpen onClose={closeModal} title="Verificar Producción" maxWidth="max-w-md">
        <p className="text-sm text-[var(--text-secondary)] mb-6">Confirma los minutos auditados para aprobar la nómina de {selectedRecord.interpreter?.name}.</p>
        
        <form action={verifyAction} className="space-y-4">
          <input type="hidden" name="id" value={selectedRecord.id} />
          
          <div>
            <label htmlFor="payroll-verifiedMinutes" className="block text-xs font-bold text-[var(--text-secondary)] mb-1 uppercase tracking-wider">Minutos Finales Verificados</label>
            <input type="number" id="payroll-verifiedMinutes" name="verifiedMinutes" required defaultValue={selectedRecord.verifiedMinutes || selectedRecord.totalMinutes} className="w-full bg-[var(--theme-control-bg)] border border-[var(--theme-control-border)] rounded-xl py-3 px-4 text-[var(--theme-control-text)] focus:border-[var(--theme-focus)] transition-colors font-mono text-xl" />
          </div>

          {verifyState?.error && <div role="alert" className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-[var(--theme-danger)] flex items-center gap-2"><AlertTriangle size={14}/> {verifyState.error}</div>}
          {verifyState?.success && <div role="status" className="p-3 bg-green-500/10 border border-green-500/20 rounded-xl text-xs text-[var(--theme-success)] flex items-center gap-2"><CheckCircle2 size={14}/> {verifyState.message}</div>}

          <div className="flex gap-3 pt-4">
            <button type="button" onClick={closeModal} className="flex-1 py-3 rounded-xl font-bold theme-action-secondary transition-all">Cancelar</button>
            <div className="flex-1">
              <SubmitButton label="Aprobar Nómina" loadingLabel="Aprobando" />
            </div>
          </div>
        </form>
        </Modal>
      )}

      {/* --- MODAL: PAGAR --- */}
      {selectedRecord && activeModal === 'PAY' && (
        <Modal isOpen onClose={closeModal} title="Desembolsar Pago" maxWidth="max-w-md">
        <div className="w-12 h-12 bg-green-500/10 rounded-2xl flex items-center justify-center text-[var(--theme-success)] mb-4 border border-green-500/20">
           <DollarSign size={24} />
        </div>
        <p className="text-sm text-[var(--text-secondary)] mb-6">Monto a depositar: <strong className="text-[var(--theme-success)]">RD${Number(selectedRecord.netTotal).toLocaleString()}</strong> a {selectedRecord.interpreter?.name}.</p>
        
        <div className="mb-6 p-4 bg-[var(--theme-surface-muted)] border border-[var(--border)] rounded-xl text-sm">
          <p className="text-[var(--text-secondary)]">Método: <span className="text-[var(--foreground)] font-bold">{selectedRecord.interpreter?.metodoPago}</span></p>
          <p className="text-[var(--text-secondary)]">Cuenta/Banco: <span className="text-[var(--foreground)]">{selectedRecord.interpreter?.cuentaPago} - {selectedRecord.interpreter?.banco}</span></p>
        </div>

        <form action={payAction} className="space-y-4">
          <input type="hidden" name="id" value={selectedRecord.id} />
          
          <div>
            <label htmlFor="payroll-transactionReference" className="block text-xs font-bold text-[var(--text-secondary)] mb-1 uppercase tracking-wider">Referencia de Transacción (Banco)</label>
            <input type="text" id="payroll-transactionReference" name="transactionReference" required placeholder="Ej. BHD-8849201" className="w-full bg-[var(--theme-control-bg)] border border-[var(--theme-control-border)] rounded-xl py-3 px-4 text-[var(--theme-control-text)] focus:border-[var(--theme-focus)] transition-colors font-mono" />
          </div>

          {payState?.error && <div role="alert" className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-[var(--theme-danger)] flex items-center gap-2"><AlertTriangle size={14}/> {payState.error}</div>}
          {payState?.success && <div role="status" className="p-3 bg-green-500/10 border border-green-500/20 rounded-xl text-xs text-[var(--theme-success)] flex items-center gap-2"><CheckCircle2 size={14}/> {payState.message}</div>}

          <div className="flex gap-3 pt-4">
            <button type="button" onClick={closeModal} className="flex-1 py-3 rounded-xl font-bold theme-action-secondary transition-all">Cancelar</button>
            <div className="flex-1">
              <SubmitButton label="Confirmar Pago" loadingLabel="Procesando" />
            </div>
          </div>
        </form>
        </Modal>
      )}

    </div>
  );
}
