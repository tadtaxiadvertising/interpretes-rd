'use client';

import React, { useState } from 'react';
import {
  Shield,
  User,
  Link as LinkIcon,
  Mail,
  ClipboardCheck,
  AlertTriangle,
} from 'lucide-react';
import type { AdminUserWithInterpreter } from '@/lib/admin-user-summary';
import { RoleBadge } from '../RoleBadge';
import { UserActions } from './UserActions';
import { InterpreterOnboardingPanel } from './InterpreterOnboardingPanel';



export function AdminUsersClientTable({ users }: { users: AdminUserWithInterpreter[] }) {
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  return (
    <>
      <div className="glass rounded-[2.5rem] overflow-hidden border border-white/5 shadow-2xl">
        <div className="p-8 border-b border-white/5 flex justify-between items-center bg-white/5">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-500/10 rounded-2xl text-blue-400">
              <Shield size={24} />
            </div>
            <h3 className="text-xl font-bold text-white">Usuarios Registrados</h3>
          </div>
          <span className="text-sm font-medium text-slate-400 bg-white/5 px-4 py-2 rounded-xl border border-white/5">
            {users.length} Usuarios Totales
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-slate-500 text-xs uppercase tracking-[0.2em] border-b border-white/5">
                <th className="py-6 px-10">Usuario</th>
                <th className="py-6 px-6">Rol de Sistema</th>
                <th className="py-6 px-6">Vínculo de Intérprete</th>
                <th className="py-6 px-6">Onboarding</th>
                <th className="py-6 px-6">Fecha Registro</th>
                <th className="py-6 px-10 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {users.map((user) => (
                <tr key={user.id} className="group hover:bg-white/[0.02] transition-all">
                  <td className="py-6 px-10">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center text-slate-400 font-bold border border-white/10 group-hover:border-blue-500/30 transition-colors">
                        {user.displayName?.charAt(0) || user.email.charAt(0)}
                      </div>
                      <div>
                        <p className="font-bold text-white text-lg">{user.displayName || 'Sin Nombre'}</p>
                        <p className="text-slate-500 text-sm flex items-center gap-1.5">
                          <Mail size={12} />
                          {user.email}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="py-6 px-6">
                    <RoleBadge role={user.role as any} />
                  </td>
                  <td className="py-6 px-6">
                    {user.interpreter ? (
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-blue-400 flex items-center gap-1.5">
                          <LinkIcon size={14} />
                          {user.interpreter.name}
                        </span>
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">
                          Campaña: {user.interpreter.campaign || 'N/A'}
                        </span>
                      </div>
                    ) : (
                      <span className="text-sm text-slate-600 italic">No vinculado</span>
                    )}
                  </td>
                  <td className="py-6 px-6">
                    {user.onboardingComplete ? (
                      <button
                        onClick={() => setSelectedUserId(user.id)}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider border bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20 hover:border-emerald-500/40 transition-all cursor-pointer"
                      >
                        <ClipboardCheck size={14} />
                        Completo
                      </button>
                    ) : (
                      <button
                        onClick={() => setSelectedUserId(user.id)}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider border bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20 hover:border-red-500/40 transition-all cursor-pointer"
                      >
                        <AlertTriangle size={14} />
                        Pendiente
                      </button>
                    )}
                  </td>
                  <td className="py-6 px-6 text-slate-400 text-sm font-medium">
                    {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="py-6 px-10 text-right">
                    <UserActions user={user} onViewOnboarding={() => setSelectedUserId(user.id)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {users.length === 0 && (
          <div className="p-24 text-center">
            <User size={64} className="mx-auto text-slate-800 mb-6" />
            <p className="text-slate-500 text-lg font-medium">No se encontraron usuarios registrados.</p>
          </div>
        )}
      </div>

      {selectedUserId && (
        <InterpreterOnboardingPanel
          userId={selectedUserId}
          onClose={() => setSelectedUserId(null)}
        />
      )}
    </>
  );
}
