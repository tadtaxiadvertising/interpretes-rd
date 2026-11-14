'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Mic2, Loader2, User, UserPlus, AlertCircle, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScenarioCard } from './ScenarioCard';
import { ROLEPLAY_MAX_SCENARIOS } from '@/lib/roleplay-limits';
import { prepareRoleplayManifestImport } from '@/lib/roleplay-manifest-import';
import { extractStudioZip } from '@/lib/roleplay-studio/zip';

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
  sha256?: string;
}

interface NewRoleplayFormProps {
  interpreters: Participant[];
  candidates: Participant[];
  initialCandidateId?: number;
  librarySource?: {
    id: string;
    fingerprint: string;
    scenarios: Array<{ title: string; durationLimitSec: number | null; scriptPrompt: string | null }>;
  };
}

// The first card is rendered by both Next.js SSR and the browser.
// A random initial ID makes all htmlFor/id attributes disagree at hydration.
const INITIAL_SCENARIO_ID = 'new-roleplay-initial-scenario';

function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

export default function NewRoleplayForm({ interpreters, candidates, initialCandidateId, librarySource }: NewRoleplayFormProps) {
  const [participantType, setParticipantType] = useState<'interpreter' | 'candidate' | 'all-active-interpreters'>(initialCandidateId ? 'candidate' : 'interpreter');
  const [selectedParticipantId, setSelectedParticipantId] = useState<string>(initialCandidateId ? String(initialCandidateId) : '');
  const [scenarios, setScenarios] = useState<Scenario[]>([
    { id: INITIAL_SCENARIO_ID, title: '', baseAudioFile: null, baseAudioPreview: '', durationLimitSec: 0, scriptPrompt: '' }
  ]);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ link: string; participantName: string; summary?: string } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  // Keep the import identity independent from React render batching. The user
  // can edit a draft while a ZIP/SHA-256 validation is still awaiting.
  const importRevision = useRef(0);
  const importPending = useRef(false);

  const invalidatePendingImport = useCallback(() => {
    // Increment on every draft edit, including one React processes after an
    // import has resolved but before its state update has committed.
    importRevision.current += 1;
    if (!importPending.current) return;
    importPending.current = false;
    setIsImporting(false);
    setError('Importación descartada: modificaste el borrador antes de terminar la verificación.');
  }, []);
  const [eligibility, setEligibility] = useState<{ activeCount: number; eligibleCount: number; skippedCount: number } | null>(null);
  const [eligibilityLoading, setEligibilityLoading] = useState(false);
  const [eligibilityError, setEligibilityError] = useState<string | null>(null);

  const participants = participantType === 'candidate' ? candidates : interpreters;
  const isBulk = participantType === 'all-active-interpreters';
  const activeInterpreterCount = interpreters.filter((participant) => participant.status === 'Activo').length;

  useEffect(() => {
    if (!isBulk) return;
    let cancelled = false;
    setEligibilityLoading(true);
    setEligibilityError(null);
    fetch('/api/admin/roleplays/eligibility', { cache: 'no-store', credentials: 'same-origin' })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || result?.success !== true || !result?.data) {
          throw new Error('No fue posible consultar las asignaciones disponibles.');
        }
        return result.data as { activeCount: number; eligibleCount: number; skippedCount: number };
      })
      .then((data) => { if (!cancelled) setEligibility(data); })
      .catch(() => { if (!cancelled) { setEligibility(null); setEligibilityError('No se pudo consultar elegibilidad. El servidor verificará nuevamente al crear.'); } })
      .finally(() => { if (!cancelled) setEligibilityLoading(false); });
    return () => { cancelled = true; };
  }, [isBulk]);

  const addScenario = useCallback(() => {
    invalidatePendingImport();
    setScenarios(prev => prev.length >= ROLEPLAY_MAX_SCENARIOS ? prev : [...prev, { 
      id: generateId(), 
      title: '', 
      baseAudioFile: null, 
      baseAudioPreview: '', 
      durationLimitSec: 0, 
      scriptPrompt: '' 
    }]);
  }, [invalidatePendingImport]);

  const removeScenario = useCallback((id: string) => {
    invalidatePendingImport();
    setScenarios(prev => {
      const removed = prev.find((scenario) => scenario.id === id);
      if (removed?.baseAudioPreview) URL.revokeObjectURL(removed.baseAudioPreview);
      return prev.filter((scenario) => scenario.id !== id);
    });
  }, [invalidatePendingImport]);

  const updateScenario = useCallback((id: string, updates: Partial<Scenario>) => {
    invalidatePendingImport();
    setScenarios(prev => prev.map((scenario) => {
      if (scenario.id !== id) return scenario;
      if (updates.baseAudioPreview && scenario.baseAudioPreview && updates.baseAudioPreview !== scenario.baseAudioPreview) {
        URL.revokeObjectURL(scenario.baseAudioPreview);
      }
      return { ...scenario, ...updates };
    }));
  }, [invalidatePendingImport]);

  const moveScenario = useCallback(function(id: string, direction: 'up' | 'down') {
    invalidatePendingImport();
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
  }, [invalidatePendingImport]);


  const handleManifestImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (selected.length === 0) return;
    const revision = ++importRevision.current;
    importPending.current = true;
    setIsImporting(true);
    setError(null);
    try {
      // Accept the exact STORE-only ZIP emitted by Audio Studio, or the legacy
      // manifest.json + MP3 selection. Both paths share SHA-256 validation.
      const files = selected.length === 1 && /\.zip$/i.test(selected[0].name)
        ? await extractStudioZip(selected[0])
        : selected;
      const prepared = await prepareRoleplayManifestImport(files);
      // Never overwrite a newer ZIP import or edits made during validation.
      if (revision !== importRevision.current) return;
      const next = prepared.map((scenario) => ({
        ...scenario,
        id: generateId(),
        baseAudioPreview: URL.createObjectURL(scenario.baseAudioFile),
      }));
      // A failed import never touches existing edits. Revoke old previews
      // only after every selected file has been verified.
      setScenarios((prev) => {
        if (revision !== importRevision.current) {
          next.forEach((scenario) => URL.revokeObjectURL(scenario.baseAudioPreview));
          return prev;
        }
        prev.forEach((scenario) => {
          if (scenario.baseAudioPreview) URL.revokeObjectURL(scenario.baseAudioPreview);
        });
        return next;
      });
    } catch (cause) {
      if (revision === importRevision.current) {
        setError(cause instanceof Error ? cause.message : 'No se pudo importar el manifiesto.');
      }
    } finally {
      if (revision === importRevision.current) {
        importPending.current = false;
        setIsImporting(false);
      }
    }
  };

  const validateForm = () => {
    if (!isBulk && !selectedParticipantId) {
      setError('Please select a participant');
      return false;
    }
    if (librarySource) return librarySource.scenarios.length > 0;
    if (scenarios.length === 0 || scenarios.length > ROLEPLAY_MAX_SCENARIOS) {
      setError(`Please add between 1 and ${ROLEPLAY_MAX_SCENARIOS} scenarios`);
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
      if (librarySource) {
        formData.append('librarySessionId', librarySource.id);
        formData.append('libraryFingerprint', librarySource.fingerprint);
      } else {
        formData.append('scenarios', JSON.stringify(scenarios.map(s => ({
          title: s.title.trim(),
          durationLimitSec: s.durationLimitSec || 0,
          scriptPrompt: s.scriptPrompt,
        }))));
        for (const scenario of scenarios) {
          if (scenario.baseAudioFile) formData.append('scenarioAudios', scenario.baseAudioFile);
        }
        formData.append('scenarioAudioSha256', JSON.stringify(scenarios.map((scenario) => scenario.sha256 ?? null)));
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
          summary: `${data.data.createdCount} sesiones creadas · ${data.data.skippedCount} omitidas. ${data.data.scenarioCount} escenarios ${librarySource ? 'reutilizados desde la biblioteca' : 'subidos una vez y compartidos entre sesiones'}.`,
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
          Created for <span className="font-bold text-white">{success.participantName}</span>
        </p>
        <p className="text-gray-400 mb-6">{librarySource?.scenarios.length ?? scenarios.length} escenarios configurados</p>
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
            {activeInterpreterCount > 0 ? ` ${activeInterpreterCount} active interpreter(s) are listed in the editor.` : ' The server will verify the active count before creating anything.'}
          </p>
          <p className="text-xs text-gray-400 mt-2">Previous drafts, active sessions and evaluated sessions are currently excluded. Audio files are uploaded once and reused across eligible sessions.</p>
          {eligibilityLoading && <p role="status" className="mt-3 text-sm text-blue-200">Verificando destinatarios elegibles…</p>}
          {eligibility && !eligibilityLoading && (
            <p role="status" className="mt-3 text-sm font-medium text-blue-100">
              Vista previa (solo lectura): {eligibility.eligibleCount} elegibles de {eligibility.activeCount} activos; {eligibility.skippedCount} omitidos por sesiones previas.
            </p>
          )}
          {eligibilityError && <p role="alert" className="mt-3 text-xs text-amber-300">{eligibilityError}</p>}
          <p className="mt-2 text-xs text-slate-400">Esta vista previa puede cambiar; al crear, el servidor vuelve a comprobar la elegibilidad.</p>
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

      {librarySource ? (
        <section className="space-y-4 rounded-2xl border border-blue-500/20 bg-blue-500/5 p-5">
          <h3 className="text-lg font-semibold text-white">Plantilla seleccionada</h3>
          <p className="text-sm text-blue-100/80">
            Los siguientes audios se reutilizarán sin volver a subir archivos. El servidor
            verificará que sigan disponibles antes de asignarlos.
          </p>
          <ol className="space-y-2">
            {librarySource.scenarios.map((scenario, index) => (
              <li key={index} className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
                <p className="font-medium text-white">{index + 1}. {scenario.title}</p>
                <p className="mt-1 text-xs text-gray-400">
                  {scenario.durationLimitSec ? `Límite de ${scenario.durationLimitSec} segundos` : 'Duración predeterminada'}
                </p>
              </li>
            ))}
          </ol>
          <p className="font-mono text-xs text-gray-500">Huella SHA-256: {librarySource.fingerprint.slice(0, 16)}…</p>
          <Link href="/admin/roleplays/library" className="inline-block text-sm font-medium text-blue-300 hover:text-blue-200">
            Elegir otra plantilla
          </Link>
        </section>
      ) : (
      <div>
        <div className="mb-5 rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
          <label htmlFor="manifest-roleplay-upload" className="block text-sm font-semibold text-blue-100">
            Importar roleplay preparado (ZIP de Audio Studio o manifest.json + MP3)
          </label>
          <p className="mt-1 text-xs text-slate-300">
            Puedes importar el ZIP generado por el estudio integrado de Intérpretes RD
             o el manifest.json y los clips MP3 del Audio Studio externo de Google.
             Para el ZIP externo, extrae primero sus archivos y selecciona el manifest.json
             y todos los MP3. Se omiten las pistas por hablante y el audio masterizado.
             Los nombres, transcripciones y notas internas nunca se publican como instrucciones.
             Las huellas SHA-256 se calculan antes de crear escenarios. La importación
             reemplaza el borrador, pero nunca publica automáticamente.
           </p>
          <input
            id="manifest-roleplay-upload"
            type="file"
            multiple
            accept=".zip,.json,.mp3,audio/mpeg,application/json,application/zip"
            disabled={isImporting || isCreating}
            onChange={(event) => { void handleManifestImport(event); }}
            className="mt-3 block w-full text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:font-semibold file:text-white disabled:opacity-50"
          />
          {isImporting && <p role="status" className="mt-2 text-sm text-blue-200">Verificando archivos y huellas SHA-256…</p>}
        </div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white">Scenarios ({scenarios.length}/{ROLEPLAY_MAX_SCENARIOS})</h3>
          <button
            onClick={addScenario}
            disabled={scenarios.length >= ROLEPLAY_MAX_SCENARIOS}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
                <span className="text-xs text-gray-500">(use arrows to reorder)</span>
              </div>
              <ScenarioCard
                scenario={scenario}
                index={index}
                scenarioCount={scenarios.length}
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

      )}

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 flex items-center gap-3">
          <AlertCircle />
          <span>{error}</span>
        </div>
      )}

      <button
        onClick={handleCreate}
        disabled={isCreating || isImporting || (!isBulk && !selectedParticipantId) || (!librarySource && scenarios.length === 0)}
        className={cn(
          "w-full py-4 rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-3",
          isCreating || isImporting || (!isBulk && !selectedParticipantId) || (!librarySource && scenarios.length === 0)
            ? "bg-slate-800 text-slate-500 cursor-not-allowed"
            : "bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/20"
        )}
      >
        {isCreating ? <><Loader2 className="animate-spin" size={24} /> Creando...</> : <><Mic2 size={24} /> {librarySource ? 'Asignar plantilla' : isBulk ? 'Crear para todos los intérpretes activos' : 'Crear roleplay'}</>}
      </button>
    </div>
  );
}