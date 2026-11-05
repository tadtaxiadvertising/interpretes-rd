'use client';

import React, { useState, useTransition } from 'react';
import { Plus, Pencil, Trash2, Check, X, Loader2, Layers } from 'lucide-react';
import { createAccount, updateAccount, deleteAccount } from '@/app/actions/account-rates';

interface Account {
  id: number;
  name: string;
  description: string | null;
  clientId: number | null;
  clientName: string | null;
}

interface Props {
  initialAccounts: Account[];
  clients: { id: number; name: string }[];
}

export function AccountManager({ initialAccounts, clients }: Props) {
  const [accounts, setAccounts] = useState<Account[]>(initialAccounts);
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newClientId, setNewClientId] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  function handleCreate() {
    if (!newName) return;
    startTransition(async () => {
      const result = await createAccount(newName, newDesc, Number(newClientId));
      if (result.success) {
        setAccounts([...accounts, result.data]);
        setNewName('');
        setNewDesc('');
        setNewClientId('');
        setShowAdd(false);
      } else {
        alert(result.error);
      }
    });
  }

  function handleUpdate(id: number) {
    if (!editName) return;
    startTransition(async () => {
      const result = await updateAccount(id, editName, editDesc);
      if (result.success) {
        setAccounts(accounts.map(a => a.id === id ? result.data : a));
        setEditingId(null);
      }
    });
  }

  function handleDelete(id: number) {
    if (!confirm('¿Estás seguro de eliminar esta cuenta?')) return;
    startTransition(async () => {
      const result = await deleteAccount(id);
      if (result.success) {
        setAccounts(accounts.filter(a => a.id !== id));
      } else {
        alert(result.error);
      }
    });
  }

  function startEditing(account: Account) {
    setEditingId(account.id);
    setEditName(account.name);
    setEditDesc(account.description || '');
  }

  return (
    <div className="glass p-8 rounded-3xl border border-white/5 space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-bold text-white flex items-center gap-3">
          <Layers className="text-purple-400" />
          Gestión de Cuentas
        </h3>
        <button 
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-2 bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 px-4 py-2 rounded-xl text-sm font-bold transition-all"
        >
          {showAdd ? <X size={16} /> : <Plus size={16} />}
          {showAdd ? 'Cancelar' : 'Nueva Cuenta'}
        </button>
      </div>

      {showAdd && (
        <div className="bg-white/5 p-6 rounded-2xl border border-purple-500/20 space-y-4 animate-in fade-in zoom-in-95 duration-300">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <select value={newClientId} onChange={(e) => setNewClientId(e.target.value)} className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white" required>
              <option value="">Seleccionar cliente propietario</option>
              {clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
            <input 
              placeholder="Nombre de la cuenta (ej. CLI, Propio)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-purple-500/50"
            />
            <input 
              placeholder="Descripción (opcional)"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-purple-500/50"
            />
          </div>
          <button 
            onClick={handleCreate}
            disabled={isPending || !newName.trim() || !newClientId || !clients.length}
            className="w-full bg-purple-600 hover:bg-purple-500 text-white py-2 rounded-xl text-sm font-bold transition-all disabled:opacity-50"
          >
            {isPending ? <Loader2 size={16} className="animate-spin mx-auto" /> : 'Crear Cuenta'}
          </button>
        </div>
      )}

      <div className="space-y-3">
        {accounts.map((account) => (
          <div key={account.id} className="group flex items-center justify-between p-4 bg-white/5 border border-white/5 rounded-2xl hover:border-white/10 transition-all">
            {editingId === account.id ? (
              <div className="flex-1 flex gap-3 mr-4">
                <input 
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="flex-1 bg-white/10 border border-purple-500/30 rounded-lg px-3 py-1 text-sm text-white focus:outline-none"
                />
                <input 
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="flex-1 bg-white/10 border border-purple-500/30 rounded-lg px-3 py-1 text-sm text-white focus:outline-none"
                />
              </div>
            ) : (
              <div>
                <p className="text-sm font-bold text-white">{account.name}</p>
                <p className="text-xs text-blue-300">{account.clientName || 'Cliente pendiente de identificar'}</p>
                {account.description && <p className="text-xs text-gray-500">{account.description}</p>}
              </div>
            )}

            <div className="flex items-center gap-2">
              {editingId === account.id ? (
                <>
                  <button onClick={() => handleUpdate(account.id)} className="p-2 bg-green-500/10 text-green-400 rounded-lg hover:bg-green-500/20">
                    <Check size={16} />
                  </button>
                  <button onClick={() => setEditingId(null)} className="p-2 bg-red-500/10 text-red-400 rounded-lg hover:bg-red-500/20">
                    <X size={16} />
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => startEditing(account)} className="p-2 text-gray-500 hover:text-white hover:bg-white/10 rounded-lg transition-all opacity-0 group-hover:opacity-100">
                    <Pencil size={16} />
                  </button>
                  <button onClick={() => handleDelete(account.id)} className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100">
                    <Trash2 size={16} />
                  </button>
                </>
              )}
            </div>
          </div>
        ))}

        {accounts.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            No hay cuentas registradas aún.
          </div>
        )}
      </div>
    </div>
  );
}
