'use client';

import React, { useState } from 'react';
import {
  MoreVertical,
  Shield,
  Link as LinkIcon,
  Trash2,
  Key,
  Edit3,
  X,
  User,
  Check,
  Loader2,
  ClipboardCheck
} from 'lucide-react';
import type { AdminUserSummary } from '@/lib/admin-user-summary';
import type { UserRole } from '@/lib/types';
import {
  updateUserRole,
  updateUserPassword,
  updateUserProfile,
  deleteUserAccess,
  getAllInterpretersList,
  linkUserToInterpreter
} from '@/app/actions/admin-users';

interface InterpreterItem {
  id: number;
  name: string;
  emailCorporativo: string | null;
  campaign: string | null;
}

export function UserActions({ user, onViewOnboarding }: { user: AdminUserSummary; onViewOnboarding?: () => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [activeModal, setActiveModal] = useState<'edit' | 'password' | 'link' | 'delete' | null>(null);

  // Form states
  const [displayName, setDisplayName] = useState(user.displayName || '');
  const [email, setEmail] = useState(user.email || '');
  const [newPassword, setNewPassword] = useState('');
  const [selectedInterpreterId, setSelectedInterpreterId] = useState<number | null>(user.interpreterId);

  // Data fetching states
  const [interpreters, setInterpreters] = useState<InterpreterItem[]>([]);
  const [isLoadingInterpreters, setIsLoadingInterpreters] = useState(false);

  const handleRoleChange = async (newRole: string) => {
    setIsUpdating(true);
    try {
      const result = await updateUserRole(user.id, newRole as UserRole);
      if (result.success) setIsOpen(false);
      else alert(result.error || 'No se pudo actualizar el rol');
    } catch {
      alert('Error al actualizar el rol');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim() || !email.trim()) return;
    setIsUpdating(true);
    try {
      const res = await updateUserProfile(user.id, { displayName, email });
      if (res.success) {
        setActiveModal(null);
        setIsOpen(false);
      } else {
        alert(res.error || 'Error al actualizar el perfil');
      }
    } catch {
      alert('Ocurrió un error inesperado');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      alert('La contraseña debe tener al menos 6 caracteres');
      return;
    }
    setIsUpdating(true);
    try {
      const res = await updateUserPassword(user.id, newPassword);
      if (res.success) {
        alert('Contraseña actualizada con éxito');
        setNewPassword('');
        setActiveModal(null);
        setIsOpen(false);
      } else {
        alert(res.error || 'Error al actualizar la contraseña');
      }
    } catch {
      alert('Ocurrió un error inesperado');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleLinkInterpreter = async () => {
    setIsUpdating(true);
    try {
      const res = await linkUserToInterpreter(user.id, selectedInterpreterId);
      if (res.success) {
        setActiveModal(null);
        setIsOpen(false);
      } else {
        alert(res.error || 'Error al vincular el intérprete');
      }
    } catch {
      alert('Ocurrió un error inesperado');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!confirm('¿Confirmas la revocación de Supabase Auth y la eliminación del perfil local? Es irreversible. Las cuentas o sesiones heredadas de NextAuth requieren comprobación independiente.')) {
      return;
    }
    setIsUpdating(true);
    try {
      const res = await deleteUserAccess(user.id);
      if (res.success) {
        setActiveModal(null);
        setIsOpen(false);
        alert('Acceso de Supabase Auth revocado y perfil local eliminado. Verifica por separado las credenciales o sesiones heredadas de NextAuth.');
      } else {
        alert(res.error || 'Error al revocar el acceso en Supabase Auth');
      }
    } catch {
      alert('Ocurrió un error inesperado');
    } finally {
      setIsUpdating(false);
    }
  };

  const openLinkModal = async () => {
    setActiveModal('link');
    setIsLoadingInterpreters(true);
    try {
      const list = await getAllInterpretersList();
      setInterpreters(list);
    } catch {
      alert('Error al cargar la lista de intérpretes');
    } finally {
      setIsLoadingInterpreters(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-3 hover:bg-white/10 rounded-2xl text-slate-400 hover:text-white transition-all active:scale-90"
      >
        <MoreVertical size={20} />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-64 bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-3 border-b border-white/5 bg-white/5">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-3 mb-2">Cambiar Rol</p>
              <div className="grid grid-cols-1 gap-1">
                {(['admin', 'interpreter', 'candidate'] as const).map((role) => (
                  <button
                    key={role}
                    disabled={isUpdating || user.role === role}
                    onClick={() => handleRoleChange(role)}
                    className="flex items-center gap-3 w-full px-3 py-2 rounded-xl text-sm font-medium text-slate-300 hover:bg-white/5 hover:text-white transition-all disabled:opacity-30"
                  >
                    <Shield size={14} className={user.role === role ? "text-blue-400" : "text-slate-600"} />
                    <span className="capitalize">{role}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="p-2 space-y-1">
              <button
                onClick={() => setActiveModal('edit')}
                className="flex items-center gap-3 w-full px-4 py-2.5 rounded-xl text-sm font-bold text-slate-300 hover:bg-white/5 hover:text-white transition-all"
              >
                <Edit3 size={16} className="text-slate-400" />
                Editar Perfil
              </button>

              <button
                onClick={() => setActiveModal('password')}
                className="flex items-center gap-3 w-full px-4 py-2.5 rounded-xl text-sm font-bold text-slate-300 hover:bg-white/5 hover:text-white transition-all"
              >
                <Key size={16} className="text-amber-400" />
                Cambiar Contraseña
              </button>

              <button
                onClick={openLinkModal}
                className="flex items-center gap-3 w-full px-4 py-2.5 rounded-xl text-sm font-bold text-blue-400 hover:bg-blue-500/10 transition-all"
              >
                <LinkIcon size={16} />
                Vincular ID Intérprete
              </button>

              {onViewOnboarding && (
                <button
                  onClick={() => { setIsOpen(false); onViewOnboarding(); }}
                  className="flex items-center gap-3 w-full px-4 py-2.5 rounded-xl text-sm font-bold text-emerald-400 hover:bg-emerald-500/10 transition-all"
                >
                  <ClipboardCheck size={16} />
                  Ver Onboarding
                </button>
              )}

              <button
                onClick={() => setActiveModal('delete')}
                className="flex items-center gap-3 w-full px-4 py-2.5 rounded-xl text-sm font-bold text-red-400 hover:bg-red-500/10 transition-all"
              >
                <Trash2 size={16} />
                Revocar acceso Supabase
              </button>
            </div>
          </div>
        </>
      )}

      {/* --- MODALES CON DISEÑO PREMIUM --- */}
      {activeModal && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-slate-950/80 backdrop-blur-md"
            onClick={() => !isUpdating && setActiveModal(null)}
          />

          {/* Modal Content */}
          <div className="relative w-full max-w-lg bg-slate-900 border border-white/10 rounded-[2.5rem] shadow-2xl overflow-hidden z-10 animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="p-6 border-b border-white/5 flex justify-between items-center bg-gradient-to-r from-blue-600/10 to-indigo-600/10">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                {activeModal === 'edit' && <Edit3 className="text-blue-400" />}
                {activeModal === 'password' && <Key className="text-amber-400" />}
                {activeModal === 'link' && <LinkIcon className="text-blue-400" />}
                {activeModal === 'delete' && <Trash2 className="text-red-400" />}
                {activeModal === 'edit' && 'Editar Datos del Usuario'}
                {activeModal === 'password' && 'Actualizar Contraseña'}
                {activeModal === 'link' && 'Vincular Intérprete Registrado'}
                {activeModal === 'delete' && 'Revocar acceso Supabase Auth'}
              </h3>
              <button
                onClick={() => !isUpdating && setActiveModal(null)}
                className="p-2 hover:bg-white/10 rounded-xl text-slate-400 hover:text-white transition-colors"
                disabled={isUpdating}
              >
                <X size={20} />
              </button>
            </div>

            {/* --- MODAL EDITAR PERFIL --- */}
            {activeModal === 'edit' && (
              <form onSubmit={handleSaveProfile} className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Nombre para mostrar</label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    required
                    className="w-full bg-slate-950 border border-white/10 rounded-2xl px-4 py-3.5 text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Correo electrónico</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full bg-slate-950 border border-white/10 rounded-2xl px-4 py-3.5 text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 transition-colors"
                  />
                </div>
                <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
                  <button
                    type="button"
                    onClick={() => setActiveModal(null)}
                    disabled={isUpdating}
                    className="px-5 py-3 rounded-2xl font-bold text-sm text-slate-400 hover:bg-white/5 transition-all disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isUpdating}
                    className="px-6 py-3 rounded-2xl font-bold text-sm bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-lg transition-all disabled:opacity-50 flex items-center gap-2"
                  >
                    {isUpdating ? <Loader2 className="animate-spin" size={16} /> : 'Guardar Cambios'}
                  </button>
                </div>
              </form>
            )}

            {/* --- MODAL CAMBIAR CONTRASEÑA --- */}
            {activeModal === 'password' && (
              <form onSubmit={handleSavePassword} className="p-6 space-y-4">
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 text-sm text-amber-300">
                  ⚠️ Esta acción cambiará directamente la contraseña del usuario en Supabase Auth de forma inmediata.
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Nueva Contraseña</label>
                  <input
                    type="password"
                    placeholder="Mínimo 6 caracteres"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    className="w-full bg-slate-950 border border-white/10 rounded-2xl px-4 py-3.5 text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 transition-colors"
                  />
                </div>
                <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
                  <button
                    type="button"
                    onClick={() => setActiveModal(null)}
                    disabled={isUpdating}
                    className="px-5 py-3 rounded-2xl font-bold text-sm text-slate-400 hover:bg-white/5 transition-all disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isUpdating}
                    className="px-6 py-3 rounded-2xl font-bold text-sm bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white shadow-lg transition-all disabled:opacity-50 flex items-center gap-2"
                  >
                    {isUpdating ? <Loader2 className="animate-spin" size={16} /> : 'Actualizar Contraseña'}
                  </button>
                </div>
              </form>
            )}

            {/* --- MODAL VINCULAR INTÉRPRETE --- */}
            {activeModal === 'link' && (
              <div className="p-6 space-y-4">
                <p className="text-sm text-slate-400">
                  Selecciona la hoja de registro del intérprete para enlazarla con esta cuenta de acceso.
                </p>

                {isLoadingInterpreters ? (
                  <div className="flex flex-col items-center justify-center p-12 gap-3 text-slate-500">
                    <Loader2 className="animate-spin" size={32} />
                    <span className="text-sm font-medium">Cargando intérpretes...</span>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                    <button
                      onClick={() => setSelectedInterpreterId(null)}
                      className={`w-full text-left p-4 rounded-2xl border transition-all flex justify-between items-center ${selectedInterpreterId === null
                        ? 'bg-blue-600/10 border-blue-500 text-white font-bold'
                        : 'bg-slate-950 border-white/5 text-slate-400 hover:border-white/10 hover:text-white'
                        }`}
                    >
                      <span>Desvincular Cuenta (Sin Enlace)</span>
                      {selectedInterpreterId === null && <Check size={16} />}
                    </button>

                    {interpreters.map((interpreter) => (
                      <button
                        key={interpreter.id}
                        onClick={() => setSelectedInterpreterId(interpreter.id)}
                        className={`w-full text-left p-4 rounded-2xl border transition-all flex justify-between items-center ${selectedInterpreterId === interpreter.id
                          ? 'bg-blue-600/10 border-blue-500 text-white font-bold'
                          : 'bg-slate-950 border-white/5 text-slate-400 hover:border-white/10 hover:text-white'
                          }`}
                      >
                        <div className="flex flex-col">
                          <span className="font-bold">{interpreter.name}</span>
                          <span className="text-[10px] text-slate-500 tracking-wider">
                            Campaña: {interpreter.campaign || 'No Asignada'} • Correo: {interpreter.emailCorporativo || 'N/A'}
                          </span>
                        </div>
                        {selectedInterpreterId === interpreter.id && <Check size={16} />}
                      </button>
                    ))}

                    {interpreters.length === 0 && (
                      <div className="p-8 text-center text-slate-600 text-sm">
                        No hay intérpretes registrados disponibles.
                      </div>
                    )}
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
                  <button
                    type="button"
                    onClick={() => setActiveModal(null)}
                    disabled={isUpdating}
                    className="px-5 py-3 rounded-2xl font-bold text-sm text-slate-400 hover:bg-white/5 transition-all disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleLinkInterpreter}
                    disabled={isUpdating || isLoadingInterpreters}
                    className="px-6 py-3 rounded-2xl font-bold text-sm bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-lg transition-all disabled:opacity-50 flex items-center gap-2"
                  >
                    {isUpdating ? <Loader2 className="animate-spin" size={16} /> : 'Guardar Enlace'}
                  </button>
                </div>
              </div>
            )}

            {/* --- MODAL CONFIRMAR ELIMINACIÓN --- */}
            {activeModal === 'delete' && (
              <div className="p-6 space-y-4">
                <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-sm text-red-400 space-y-2">
                  <p className="font-bold flex items-center gap-1.5">⚠️ ALERTA CRÍTICA:</p>
                  <p>Esto eliminará el perfil local de {user.displayName || user.email} y revocará su identidad de Supabase Auth.</p>
                  <p role="alert" className="font-semibold">Importante: no revoca automáticamente posibles credenciales ni sesiones heredadas de NextAuth. Comprueba ese acceso por separado antes de dar por completada la baja.</p>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
                  <button
                    type="button"
                    onClick={() => setActiveModal(null)}
                    disabled={isUpdating}
                    className="px-5 py-3 rounded-2xl font-bold text-sm text-slate-400 hover:bg-white/5 transition-all disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleDeleteUser}
                    disabled={isUpdating}
                    className="px-6 py-3 rounded-2xl font-bold text-sm bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white shadow-lg transition-all disabled:opacity-50 flex items-center gap-2"
                  >
                    {isUpdating ? <Loader2 className="animate-spin" size={16} /> : 'Revocar Supabase Auth'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
