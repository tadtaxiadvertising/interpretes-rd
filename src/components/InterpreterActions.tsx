'use client';

import React, { useRef, useState } from 'react';
import { 
  MoreVertical, 
  Edit, 
  Trash2, 
  Key,
  Loader2,
  AlertTriangle,
  Save
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { InterpreterForm } from './InterpreterForm';
import { Modal } from './Modal';
import { deleteInterpreter, resetInterpreterPassword } from '@/app/actions/interpreters';

interface InterpreterActionsProps {
  interpreter: {
    id: number;
    name: string;
    emailCorporativo: string | null;
    [key: string]: unknown;
  };
}

export function InterpreterActions({ interpreter }: InterpreterActionsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteNeedsReview, setDeleteNeedsReview] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetNeedsReview, setResetNeedsReview] = useState(false);
  const router = useRouter();
  const deleting = useRef(false);
  const resetting = useRef(false);

  const handleDelete = async () => {
    // A partial deprovisioning cannot safely be retried from this dialog:
    // the local record is gone and the external Auth result is uncertain.
    if (deleting.current || deleteNeedsReview) return;
    deleting.current = true;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const result = await deleteInterpreter(interpreter.id);
      if (!result.success) {
        setDeleteError(result.error || 'No se pudo confirmar la baja. Verifica el estado antes de reintentar.');
        if (result.code === 'PARTIAL_FAILURE') {
          setDeleteNeedsReview(true);
        }
        return;
      }
      setShowDeleteConfirm(false);
      toast.success('Baja del intérprete completada');
      router.refresh();
    } catch {
      // Browser errors from Server Actions may contain sensitive strings.
      setDeleteError('No se pudo confirmar la baja. Verifica el estado antes de reintentar.');
      setDeleteNeedsReview(true);
    } finally {
      deleting.current = false;
      setIsDeleting(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    // A provider operation with an uncertain result is not safe to repeat.
    if (resetting.current || resetNeedsReview) return;
    resetting.current = true;
    setIsResetting(true);
    setResetError(null);
    try {
      const result = await resetInterpreterPassword(interpreter.id, newPassword);
      if (!result.success) {
        setResetError(result.error || 'No se pudo confirmar el restablecimiento. Verifica el estado antes de reintentar.');
        if (result.code === 'PARTIAL_FAILURE') setResetNeedsReview(true);
        return;
      }
      setShowResetModal(false);
      setNewPassword('');
      toast.success('Contraseña actualizada correctamente');
    } catch {
      setResetError('No se pudo confirmar el restablecimiento. Verifica el estado antes de reintentar.');
      setResetNeedsReview(true);
    } finally {
      resetting.current = false;
      setIsResetting(false);
    }
  };


  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Acciones del intérprete"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "rounded-xl p-2 transition-colors hover:bg-[var(--theme-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600",
          isOpen ? "bg-[var(--theme-hover)] text-[var(--foreground)]" : "text-[var(--text-secondary)] hover:text-[var(--foreground)]"
        )}
      >
        <MoreVertical size={20} />
      </button>

      {isOpen && (
        <>
          <div 
            className="fixed inset-0 z-10" 
            onClick={() => setIsOpen(false)} 
          />
          <div className="absolute right-0 mt-2 w-48 bg-[var(--theme-panel)] text-[var(--foreground)] border border-[var(--border)] rounded-2xl shadow-2xl z-20 py-2 animate-in fade-in zoom-in-95 duration-200">
            <button 
              className="w-full px-4 py-2 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--theme-hover)] hover:text-[var(--foreground)] flex items-center gap-3 transition-colors"
              onClick={() => {
                setIsOpen(false);
                setShowEditModal(true);
              }}
            >
              <Edit size={16} />
              Edit Profile
            </button>
            <button 
              className="w-full px-4 py-2 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--theme-hover)] hover:text-[var(--foreground)] flex items-center gap-3 transition-colors"
              onClick={() => {
                setIsOpen(false);
                setShowResetModal(true);
              }}
            >
              <Key size={16} />
              Reset Password
            </button>
            <div className="h-px bg-[var(--border)] my-1" />
            <button 
              className="w-full px-4 py-2 text-left text-sm text-[var(--theme-danger)] hover:bg-red-500/10 flex items-center gap-3 transition-colors"
              onClick={() => {
                setDeleteError(null);
                setShowDeleteConfirm(true);
                setIsOpen(false);
              }}
            >
              <Trash2 size={16} />
              Delete Account
            </button>
          </div>
        </>
      )}

      {/* Edit Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        title={`Edit Profile: ${interpreter.name}`}
      >
        <InterpreterForm 
          initialData={interpreter}
          interpreterId={interpreter.id}
          onSuccess={() => {
            setShowEditModal(false);
            router.refresh();
          }}
          onCancel={() => setShowEditModal(false)}
        />
      </Modal>

      {/* Reset Password Modal */}
      <Modal
        isOpen={showResetModal}
        onClose={() => setShowResetModal(false)}
        title="Reset Password"
        closeDisabled={isResetting}
        maxWidth="max-w-md"
      >
        <form onSubmit={handleResetPassword} className="space-y-6">
          {resetError && (
            <div role="alert" className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-[var(--theme-danger)] text-xs">
              {resetError}
              {resetNeedsReview && <p className="mt-2 font-semibold">No vuelvas a enviar esta contraseña. Revisa la identidad y el acceso en Auth.</p>}
            </div>
          )}
          <div className="space-y-2">
            <label className="text-xs font-bold text-[var(--text-tertiary)] uppercase tracking-widest ml-1">New Password</label>
            <div className="relative">
              <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={18} />
              <input
                required
                type="password"
                autoComplete="new-password"
                disabled={isResetting || resetNeedsReview}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full bg-[var(--theme-control-bg)] border border-[var(--theme-control-border)] rounded-2xl py-3 pl-12 pr-4 text-[var(--theme-control-text)] focus:border-[var(--theme-focus)] transition-all outline-none focus:ring-2 focus:ring-[var(--theme-focus)]"
                placeholder="Min 6 characters"
                minLength={6}
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={isResetting || resetNeedsReview}
            className="w-full py-4 theme-action-primary rounded-2xl font-bold transition-all flex items-center justify-center gap-2"
          >
            {isResetting ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
            {resetNeedsReview ? 'Revisión de Auth necesaria' : 'Actualizar contraseña'}
          </button>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title="Delete Interpreter?"
        closeDisabled={isDeleting}
        maxWidth="max-w-sm"
      >
        <div className="text-center">
          <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center text-[var(--theme-danger)] mx-auto mb-6">
            <AlertTriangle size={32} />
          </div>
          <p className="text-[var(--text-secondary)] text-sm mb-5 leading-relaxed">
            ¿Eliminar a <span className="text-[var(--foreground)] font-bold">{interpreter.name}</span>?
            Se eliminarán sus registros locales permitidos y se intentará revocar su acceso.
            Si la revocación no se confirma, será necesaria una revisión administrativa.
          </p>
          {deleteError && (
            <div role="alert" className="text-left text-[var(--theme-danger)] text-sm bg-red-500/10 border border-red-500/20 rounded-xl p-3 mb-5">
              {deleteError}
              {deleteNeedsReview && (
                <p className="mt-2 font-semibold">No vuelvas a ejecutar esta baja. Verifica la cuenta en Auth con un administrador.</p>
              )}
            </div>
          )}
          <div className="flex gap-4">
            <button 
              onClick={() => setShowDeleteConfirm(false)}
              disabled={isDeleting}
              className="flex-1 py-3 theme-action-secondary rounded-xl font-bold transition-all"
            >
              Cancel
            </button>
            <button 
              onClick={handleDelete}
              disabled={isDeleting || deleteNeedsReview}
              className="flex-1 py-3 theme-action-danger rounded-xl font-bold transition-all flex items-center justify-center gap-2"
            >
              {isDeleting ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
              {deleteNeedsReview ? 'Revisión necesaria' : 'Eliminar'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
