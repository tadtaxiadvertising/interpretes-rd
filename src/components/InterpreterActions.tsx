'use client';

import React, { useState } from 'react';
import { 
  MoreVertical, 
  Edit, 
  Trash2, 
  Key,
  Loader2,
  AlertTriangle,
  Save
} from 'lucide-react';
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

  const handleDelete = async () => {
    // A partial deprovisioning cannot safely be retried from this dialog:
    // the local record is gone and the external Auth result is uncertain.
    if (isDeleting || deleteNeedsReview) return;
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
      router.refresh();
    } catch {
      // Browser errors from Server Actions may contain sensitive strings.
      setDeleteError('No se pudo confirmar la baja. Verifica el estado antes de reintentar.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    // A provider operation with an uncertain result is not safe to repeat.
    if (isResetting || resetNeedsReview) return;
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
      alert('Contraseña actualizada correctamente');
    } catch {
      setResetError('No se pudo confirmar el restablecimiento. Verifica el estado antes de reintentar.');
    } finally {
      setIsResetting(false);
    }
  };


  return (
    <div className="relative">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "p-2 hover:bg-white/10 rounded-xl transition-colors",
          isOpen ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"
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
          <div className="absolute right-0 mt-2 w-48 bg-[#1a1a24] border border-white/10 rounded-2xl shadow-2xl z-20 py-2 animate-in fade-in zoom-in-95 duration-200">
            <button 
              className="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-white/5 flex items-center gap-3 transition-colors"
              onClick={() => {
                setIsOpen(false);
                setShowEditModal(true);
              }}
            >
              <Edit size={16} />
              Edit Profile
            </button>
            <button 
              className="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-white/5 flex items-center gap-3 transition-colors"
              onClick={() => {
                setIsOpen(false);
                setShowResetModal(true);
              }}
            >
              <Key size={16} />
              Reset Password
            </button>
            <div className="h-px bg-white/5 my-1" />
            <button 
              className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-red-500/10 flex items-center gap-3 transition-colors"
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
        maxWidth="max-w-md"
      >
        <form onSubmit={handleResetPassword} className="space-y-6">
          {resetError && (
            <div role="alert" className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">
              {resetError}
              {resetNeedsReview && <p className="mt-2 font-semibold">No vuelvas a enviar esta contraseña. Revisa la identidad y el acceso en Auth.</p>}
            </div>
          )}
          <div className="space-y-2">
            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">New Password</label>
            <div className="relative">
              <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
              <input
                required
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-12 pr-4 text-white focus:border-blue-500/50 transition-all outline-none focus:ring-2 focus:ring-blue-500/20"
                placeholder="Min 6 characters"
                minLength={6}
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={isResetting || resetNeedsReview}
            className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-50"
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
        maxWidth="max-w-sm"
      >
        <div className="text-center">
          <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center text-red-500 mx-auto mb-6">
            <AlertTriangle size={32} />
          </div>
          <p className="text-gray-400 text-sm mb-5 leading-relaxed">
            ¿Eliminar a <span className="text-white font-bold">{interpreter.name}</span>?
            Se eliminarán sus registros locales permitidos y se intentará revocar su acceso.
            Si la revocación no se confirma, será necesaria una revisión administrativa.
          </p>
          {deleteError && (
            <div role="alert" className="text-left text-red-300 text-sm bg-red-500/10 border border-red-500/20 rounded-xl p-3 mb-5">
              {deleteError}
              {deleteNeedsReview && (
                <p className="mt-2 font-semibold">No vuelvas a ejecutar esta baja. Verifica la cuenta en Auth con un administrador.</p>
              )}
            </div>
          )}
          <div className="flex gap-4">
            <button 
              onClick={() => setShowDeleteConfirm(false)}
              className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-gray-400 rounded-xl font-bold transition-all border border-white/10"
            >
              Cancel
            </button>
            <button 
              onClick={handleDelete}
              disabled={isDeleting || deleteNeedsReview}
              className="flex-1 py-3 bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold transition-all flex items-center justify-center gap-2"
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
