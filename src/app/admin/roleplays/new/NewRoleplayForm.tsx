'use client';

import React, { useState, useCallback } from 'react';
import Link from 'next/link';
import { Mic2, Loader2, User, UserPlus, AlertCircle, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScenarioCard } from './ScenarioCard';

interface Participant {
  id: number;
  name: string;
  email?: string | null;
  externalId?: string | null;
  emailCorporativo?: string | null;
  status?: string | null;
}

interface Scenario {
  id: string;
  title: string;
  baseAudioFile: File | null;
  baseAudioPreview: string;
  durationLimitSec: number;
  scriptPrompt: string;
}

interface NewRoleplayFormProps {
  interpreters: Participant[];
  candidates: Participant[];
}

function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

export default function NewRoleplayForm({ interpreters, candidates }: NewRoleplayFormProps) {
  const [participantType, setParticipantType] = useState<'interpreter' | 'candidate' | 'all-active-interpreters'>('interpreter');
  const [selectedParticipantId, setSelectedParticipantId] = useState<string>('');
  const [scenarios, setScenarios] = useState<Scenario[]>([
    { id: generateId(), title: '', baseAudioFile: null, baseAudioPreview: '', durationLimitSec: 0, scriptPrompt: '' }
  ]);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ link: string; participantName: string; summary?: string } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const participants = participantType === 'candidate' ? candidates : interpreters;
  const isBulk = participantType === 'all-active-interpreters';
  const activeInterpreterCount = interpreters.filter((participant) => participant.status === 'Activo').length;

  const addScenario = useCallback(() => {
    setScenarios(prev => [...prev, { 
      id: generateId(), 
      title: '', 
      baseAudioFile: null, 
      baseAudioPreview: '', 
      durationLimitSec: 0, 
      scriptPrompt: '' 
    }]);
  }, []);

  const removeScenario = useCallback((id: string) => {
    setScenarios(prev => prev.filter(s => s.id !== id));
  }, []);

  const updateScenario = useCallback((id: string, updates: Partial<Scenario>) => {
    setScenarios(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  }, []);

  const moveScenario = useCallback(function(id: string, direction: 'up' | 'down') {
    setScenarios(prev => {
      const index = prev.findIndex(s => s.id === id);
      if (index === -1) return prev;
      if (direction === 'up' && index === 0) return prev;
      if (direction === 'down' && index === prev.length - 1) return prev;
      
      const newScenarios = [...prev];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      [newScenarios[index], newScenarios[targetIndex]] = [newScenarios[targetIndex], newScenarios[index]];
      return newScenarios;
    });
  }, []);


  const validateForm = () => {
    if (!isBulk && !selectedParticipantId) {
      setError('Please select a participant');
      return false;
    }
    if (scenarios.length === 0) {
      setError('Please add at least one scenario');
      return false;
    }
    for (const scenario of scenarios) {
      if (!scenario.title.trim()) {
        setError('All scenarios must have a title');
        return false;
      }
      if (!scenario.baseAudioFile) {
        setError('All scenarios must have a base audio file');
        return false;
      }
    }
    return true;
  };

  const handleCreate = async () => {
    if (!validateForm()) return;

    setIsCreating(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('participantType', participantType);
      if (!isBulk) formData.append('participantId', selectedParticipantId);
      formData.append('scenarios', JSON.stringify(scenarios.map(s => ({
        title: s.title.trim(),
        durationLimitSec: s.durationLimitSec || 0,
        scriptPrompt: s.scriptPrompt,
      }))));
      for (const scenario of scenarios) {
        if (scenario.baseAudioFile) {
          formData.append('scenarioAudios', scenario.baseAudioFile);
        }
      }

      const res = await fetch('/api/admin/roleplays', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!data.success) throw new Error(data.error || 'Failed to create roleplay');

      if (data.data.bulk) {
        setSuccess({
          link: `${window.location.origin}/admin/roleplays`,
          participantName: `${data.data.createdCount} active interpreter(s)`,
          summary: `${data.data.createdCount} sessions created · ${data.data.skippedCount} skipped because they already have a draft or active roleplay. ${data.data.scenarioCount} scenario(s) were uploaded once and reused across sessions.`,
        });
      } else {
        setSuccess({
          link: data.data.inviteLink || `${window.location.origin}/roleplays/${data.data.sessionId}`,
          participantName: participantType === 'interpreter'
            ? interpreters.find(i => i.id === parseInt(selectedParticipantId))?.name || 'Interpreter'
            : candidates.find(c => c.id === parseInt(selectedParticipantId))?.name || 'Candidate',
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create roleplay');
    } finally {
      setIsCreating(false);
    }
  };


  if (success) {
    return (
      <div className="glass p-8 rounded-3xl border border-white/5 text-center animate-in fade-in">
        <div className="w-20 h-20 bg-green-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <Mic2 size={40} className="text-green-400" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">{success.summary ? 'Bulk roleplays created' : 'Roleplay Created!'}</h2>
        <p className="text-gray-400 mb-6">
          Session created for <span className="font-bold text-white">{success.participantName}</span>
        </p>
        <p className="text-gray-400 mb-6">{scenarios.length} scenario(s) configured</p>
        {success.summary && <p className="text-sm text-gray-300 mb-6">{success.summary}</p>}
        <div className="mb-6 p-4 bg-slate-900/50 rounded-xl">
          <input 
            type="text" 
            value={success.link} 
            readOnly
            className="w-full bg-slate-950 border border-white/10 rounded-xl py-3 px-4 text-white text-sm text-center"
          />
        </div>
        <div className="flex gap-4 justify-center">
          <button 
            onClick={() => navigator.clipboard.writeText(success.link)}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-colors flex items-center gap-2"
          >
            Copy Link
          </button>
          <Link 
            href="/admin/roleplays"
            className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-bold transition-colors"
          >
            View All Roleplays
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="glass p-8 rounded-3xl border border-white/5 space-y-8">
      <div>
        <h3 className="text-lg font-bold text-white mb-4">Participant Type</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <button
            onClick={() => { setParticipantType('interpreter'); setSelectedParticipantId(''); setError(null); }}
            className={cn(
              "p-4 rounded-2xl border-2 transition-all flex items-center justify-center gap-3",
              participantType === 'interpreter'
                ? "border-blue-500 bg-blue-500/10"
                : "border-white/10 hover:border-white/20"
            )}
          >
            <User size={24} className={cn(participantType === 'interpreter' ? 'text-blue-400' : 'text-gray-400')} />
            <span className={cn(participantType === 'interpreter' ? 'text-blue-400' : 'text-gray-300')}>
              Interpreter
            </span>
          </button>
          <button
            onClick={() => { setParticipantType('candidate'); setSelectedParticipantId(''); setError(null); }}
            className={cn(
              "p-4 rounded-2xl border-2 transition-all flex items-center justify-center gap-3",
              participantType === 'candidate'
                ? "border-green-500 bg-green-500/10"
                : "border-white/10 hover:border-white/20"
            )}
          >
            <UserPlus size={24} className={cn(participantType === 'candidate' ? 'text-green-400' : 'text-gray-400')} />
            <span className={cn(participantType === 'candidate' ? 'text-green-400' : 'text-gray-300')}>
              Candidate
            </span>
          </button>
          <button
            onClick={() => { setParticipantType('all-active-interpreters'); setSelectedParticipantId(''); setError(null); }}
            className={cn(
              "p-4 rounded-2xl border-2 transition-all flex flex-col items-center justify-center gap-2",
              isBulk ? "border-blue-500 bg-blue-500/10" : "border-white/10 hover:border-white/20"
            )}
          >
            <UserPlus size={24} className={cn(isBulk ? 'text-blue-400' : 'text-gray-400')} />
            <span className={cn("text-center", isBulk ? 'text-blue-400' : 'text-gray-300')}>All active interpreters</span>
          </button>
        </div>
      </div>

      {isBulk ? (
        <div className="p-4 rounded-xl border border-blue-500/20 bg-blue-500/5">
          <p className="font-semibold text-white">Bulk assignment</p>
          <p className="text-sm text-gray-300 mt-1">
            The roleplay will be created for every interpreter whose status is exactly “Activo”.
            {activeInterpreterCount > 0 ? ` ${activeInterpreterCount} active interpreter(s) are currently listed.` : ' The server will verify the active count before creating anything.'}
          </p>
          <p className="text-xs text-gray-400 mt-2">Existing drafts and roleplays that are in progress or already evaluated are skipped. Scenario audios are uploaded once and reused.</p>
        </div>
      ) : (
        <div>
          <h3 className="text-lg font-bold text-white mb-4">Select Participant</h3>
          <select
            value={selectedParticipantId}
            onChange={(e) => setSelectedParticipantId(e.target.value)}
            className="w-full bg-slate-950 border border-white/10 rounded-xl py-3 px-4 text-white focus:border-blue-500 transition-colors"
          >
            <option value="">Choose a {participantType}...</option>
            {participants.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.email || p.externalId || p.emailCorporativo})
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white">Scenarios</h3>
          <button
            onClick={addScenario}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-colors flex items-center gap-2"
          >
            <Plus size={18} />
            Add Scenario
          </button>
        </div>

        <div className="space-y-4">
          {scenarios.map((scenario, index) => (
            <div key={scenario.id} className="group" onDragStart={() => setDraggingId(scenario.id)} onDragEnd={() => setDraggingId(null)}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-medium text-gray-400">Scenario {index + 1}</span>
                <span className="text-xs text-gray-500">(drag to reorder)</span>
              </div>
              <ScenarioCard
                scenario={scenario}
                index={index}
                onUpdate={updateScenario}
                onRemove={removeScenario}
                onMoveUp={() => moveScenario(scenario.id, 'up')}
                onMoveDown={() => moveScenario(scenario.id, 'down')}
                isDragging={draggingId === scenario.id}
              />
            </div>
          ))}
          
          {scenarios.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              No scenarios added yet. Click "Add Scenario" to start.
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 flex items-center gap-3">
          <AlertCircle />
          <span>{error}</span>
        </div>
      )}

      <button
        onClick={handleCreate}
        disabled={isCreating || (!isBulk && !selectedParticipantId) || scenarios.length === 0}
        className={cn(
          "w-full py-4 rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-3",
          isCreating || (!isBulk && !selectedParticipantId) || scenarios.length === 0
            ? "bg-slate-800 text-slate-500 cursor-not-allowed"
            : "bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/20"
        )}
      >
        {isCreating ? <><Loader2 className="animate-spin" size={24} /> Creating...</> : <><Mic2 size={24} /> {isBulk ? 'Create for all active interpreters' : 'Create Roleplay'}</>}
      </button>
    </div>
  );
}