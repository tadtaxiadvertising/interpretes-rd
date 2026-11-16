'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Mic2, Loader2, User, UserPlus, AlertCircle, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScenarioCard } from './ScenarioCard';
import { ROLEPLAY_MAX_SCENARIOS } from '@/lib/roleplay-limits';
import { prepareRoleplayManifestImport } from '@/lib/roleplay-manifest-import';
import { extractStudioZip } from '@/lib/roleplay-studio/zip';
import { extractExternalStudioZip } from '@/lib/roleplay-studio/external-zip';

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
  studioTurn?: number;
  studioSpeaker?: 'speaker_1' | 'speaker_2' | 'speaker_3';
  studioLanguage?: 'en' | 'es' | 'mixed';
  sourceStartSec?: number | null;
  sourceEndSec?: number | null;
  sha256?: string;
}

interface NewRoleplayFormProps {
  interpreters: Participant[];
  candidates: Participant[];
  initialCandidateId?: number;
  librarySource?: {
    id: string;
    fingerprint: string;
    scenarios: Array<{ title: string; durationLimitSec: number | null; scriptPrompt: string | null; studioTurn?: number | null; studioSpeaker?: string | null; studioLanguage?: string | null; sourceStartSec?: number | null; sourceEndSec?: number | null }>;
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
  const [participantSearch, setParticipantSearch] = useState('');
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
  // Object URLs are browser resources. Track every preview created by this
  // editor, including previews awaiting React state commits. Releasing only
  // on replace/remove leaks them when navigating away from the form.
  const previewUrls = useRef<Set<string>>(new Set());

  useEffect(() => {
    return () => {
      // Cancel async ZIP/SHA-256 work from committing after unmount.
      importRevision.current += 1;
      importPending.current = false;
      for (const url of previewUrls.current) URL.revokeObjectURL(url);
      previewUrls.current.clear();
    };
  }, []);

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
  const selectedParticipant = participants.find((participant) => String(participant.id) === selectedParticipantId);
  const search = participantSearch.trim().toLocaleLowerCase('es');
  const matchingParticipants = search
    ? participants.filter((participant) => [
        participant.name, participant.email, participant.externalId, participant.emailCorporativo,
      ].some((value) => (value ?? '').toLocaleLowerCase('es').includes(search)))
    : participants;
  // Do not silently drop the selected option when the administrator searches
  // for someone else: the user should explicitly choose a different target.
  const visibleParticipants = selectedParticipant &&
    !matchingParticipants.some((participant) => participant.id === selectedParticipant.id)
    ? [selectedParticipant, ...matchingParticipants] : matchingParticipants;
  const scenarioCount = librarySource?.scenarios.length ?? scenarios.length;
  const readyScenarioCount = librarySource?.scenarios.length ??
    scenarios.filter((scenario) => scenario.title.trim() && scenario.baseAudioFile).length;

  const changeParticipantType = (nextType: typeof participantType) => {
    if (nextType === participantType) return;
    setParticipantType(nextType);
    setSelectedParticipantId('');
    setParticipantSearch('');
    setEligibility(null);
    setEligibilityError(null);
    setError(null);
  };

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
      if (removed?.baseAudioPreview) {
        previewUrls.current.delete(removed.baseAudioPreview);
        URL.revokeObjectURL(removed.baseAudioPreview);
      }
      return prev.filter((scenario) => scenario.id !== id);
    });
  }, [invalidatePendingImport]);

  const updateScenario = useCallback((id: string, updates: Partial<Scenario>) => {
    invalidatePendingImport();
    // Track new URLs before state commits so unmount can still release them.
    if (updates.baseAudioPreview?.startsWith('blob:')) previewUrls.current.add(updates.baseAudioPreview);
    setScenarios(prev => prev.map((scenario) => {
      if (scenario.id !== id) return scenario;
      if (updates.baseAudioPreview && scenario.baseAudioPreview && updates.baseAudioPreview !== scenario.baseAudioPreview) {
        previewUrls.current.delete(scenario.baseAudioPreview);
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
      // Preserve the strict native ZIP contract. When it is not a native
      // package, attempt the bounded external Audio Studio reader; both still
      // pass through the canonical manifest + SHA-256 validation.
      let files = selected;
      if (selected.length === 1 && /\.zip$/i.test(selected[0].name)) {
        try {
          files = await extractStudioZip(selected[0]);
        } catch (nativeError) {
          try {
            files = await extractExternalStudioZip(selected[0]);
          } catch (externalError) {
            // A damaged native ZIP should retain its CRC32 diagnostic.
            if (nativeError instanceof Error && /CRC32/.test(nativeError.message)) throw nativeError;
            throw externalError;
          }
        }
      }
      const prepared = await prepareRoleplayManifestImport(files);
      // Never overwrite a newer ZIP import or edits made during validation.
      if (revision !== importRevision.current) return;
      const next = prepared.map((scenario) => {
        const baseAudioPreview = URL.createObjectURL(scenario.baseAudioFile);
        previewUrls.current.add(baseAudioPreview);
        return { ...scenario, id: generateId(), baseAudioPreview };
      });
      // A failed import never touches existing edits. Revoke old previews
      // only after every selected file has been verified.
      setScenarios((prev) => {
        if (revision !== importRevision.current) {
          next.forEach((scenario) => {
            previewUrls.current.delete(scenario.baseAudioPreview);
            URL.revokeObjectURL(scenario.baseAudioPreview);
          });
          return prev;
        }
        prev.forEach((scenario) => {
          if (scenario.baseAudioPreview) {
            previewUrls.current.delete(scenario.baseAudioPreview);
            URL.revokeObjectURL(scenario.baseAudioPreview);
          }
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
          studioTurn: s.studioTurn ?? null,
          studioSpeaker: s.studioSpeaker ?? null,
          studioLanguage: s.studioLanguage ?? null,
          sourceStartSec: s.sourceStartSec ?? null,
          sourceEndSec: s.sourceEndSec ?? null,
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
    <div className="glass rounded-3xl border border-white/5 p-4 sm:p-6 space-y-5">
      <div>
        <h3 className="text-lg font-bold text-white mb-2">¿A quién se asignará?</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <button
            type="button"
            aria-pressed={participantType === 'interpreter'}
            onClick={() => changeParticipantType('interpreter')}
            className={cn(
              "p-4 rounded-2xl border-2 transition-all flex items-center justify-center gap-3",
              participantType === 'interpreter'
                ? "border-blue-500 bg-blue-500/10"
                : "border-white/10 hover:border-white/20"
            )}
          >
            <User size={24} className={cn(participantType === 'interpreter' ? 'text-blue-400' : 'text-gray-400')} />
            <span className={cn(participantType === 'interpreter' ? 'text-blue-400' : 'text-gray-300')}>
              Intérprete
            </span>
          </button>
          <button
            type="button"
            aria-pressed={participantType === 'candidate'}
            onClick={() => changeParticipantType('candidate')}
            className={cn(
              "p-4 rounded-2xl border-2 transition-all flex items-center justify-center gap-3",
              participantType === 'candidate'
                ? "border-green-500 bg-green-500/10"
                : "border-white/10 hover:border-white/20"
            )}
          >
            <UserPlus size={24} className={cn(participantType === 'candidate' ? 'text-green-400' : 'text-gray-400')} />
            <span className={cn(participantType === 'candidate' ? 'text-green-400' : 'text-gray-300')}>
              Candidato
            </span>
          </button>
          <button
            type="button"
            aria-pressed={isBulk}
            onClick={() => changeParticipantType('all-active-interpreters')}
            className={cn(
              "p-4 rounded-2xl border-2 transition-all flex flex-col items-center justify-center gap-2",
              isBulk ? "border-blue-500 bg-blue-500/10" : "border-white/10 hover:border-white/20"
            )}
          >
            <UserPlus size={24} className={cn(isBulk ? 'text-blue-400' : 'text-gray-400')} />
            <span className={cn("text-center", isBulk ? 'text-blue-400' : 'text-gray-300')}>Todos los intérpretes activos</span>
          </button>
        </div>
      </div>

      {isBulk ? (
        <div className="p-4 rounded-xl border border-blue-500/20 bg-blue-500/5">
          <p className="font-semibold text-white">Asignación masiva</p>
          <p className="text-sm text-gray-300 mt-1">
            Se creará una sesión para los intérpretes elegibles con estado «Activo».
            {activeInterpreterCount > 0 ? ` Hay ${activeInterpreterCount} activos en la lista.` : ' El servidor verificará el total antes de crear sesiones.'}
          </p>
          <p className="text-xs text-gray-400 mt-2">Se omiten las sesiones anteriores que impidan una nueva asignación. Los audios se cargan una sola vez y se reutilizan según la elegibilidad verificada en el servidor.</p>
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
        <div className="space-y-2">
          <label htmlFor="roleplay-participant-search" className="block text-sm font-semibold text-white">
            Buscar {participantType === 'candidate' ? 'candidato' : 'intérprete'}
          </label>
          <input
            id="roleplay-participant-search"
            type="search"
            autoComplete="off"
            value={participantSearch}
            onChange={(event) => setParticipantSearch(event.currentTarget.value)}
            placeholder="Nombre, correo o identificador…"
            className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-2.5 text-white placeholder:text-slate-500 focus:border-blue-500"
          />
          <label htmlFor="roleplay-participant-select" className="block text-sm text-slate-300">
            Destinatario · {matchingParticipants.length} coincidencia(s)
          </label>
          <select
            id="roleplay-participant-select"
            value={selectedParticipantId}
            onChange={(event) => { setSelectedParticipantId(event.currentTarget.value); setError(null); }}
            className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-white focus:border-blue-500"
          >
            <option value="">Selecciona un {participantType === 'candidate' ? 'candidato' : 'intérprete'}…</option>
            {visibleParticipants.map((participant) => {
              const identifier = participant.email || participant.externalId || participant.emailCorporativo;
              return (
                <option key={participant.id} value={participant.id}>
                  {participant.name}{identifier ? ` (${identifier})` : ''}
                </option>
              );
            })}
          </select>
          {search && matchingParticipants.length === 0 && (
            <p className="text-xs text-amber-200">
              Sin coincidencias. Prueba otro nombre, correo o identificador.
              {selectedParticipant ? ' El destinatario seleccionado se conserva.' : ''}
            </p>
          )}
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
            Importa un ZIP o manifest.json con sus MP3. Se sustituirá el borrador,
            pero no se creará ninguna sesión hasta que confirmes la asignación.
          </p>
          <details className="mt-2 text-xs text-slate-300">
            <summary className="cursor-pointer text-blue-200">Formatos admitidos y privacidad</summary>
            <p className="mt-2 leading-5">
              Se admiten paquetes ZIP del estudio integrado o externo (STORE/DEFLATE, sin cifrado),
              o manifest.json con todos los MP3 individuales. En los ZIP externos se omiten
              pistas por hablante y el audio masterizado. Los nombres, transcripciones y notas
              internas no se publican como instrucciones. Se verifican las huellas SHA-256
              antes de crear escenarios; importar no publica automáticamente.
            </p>
          </details>
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

      <section aria-label="Resumen de asignación" className="rounded-xl border border-white/10 bg-slate-950/60 p-3 sm:p-4 space-y-2">
        <h3 className="text-sm font-semibold text-white">Revisión antes de crear</h3>
        <p className="text-sm text-slate-300">
          Destinatario: <span className="font-medium text-white">
            {isBulk
              ? eligibility && !eligibilityLoading
                ? `${eligibility.eligibleCount} ${eligibility.eligibleCount === 1 ? 'intérprete elegible' : 'intérpretes elegibles'} de ${eligibility.activeCount} activos`
                : 'Intérpretes activos (elegibilidad pendiente de verificación)'
              : selectedParticipant
                ? `${selectedParticipant.name} · ${participantType === 'candidate' ? 'Candidato' : 'Intérprete'}`
                : 'Sin seleccionar'}
          </span>
        </p>
        <p className="text-sm text-slate-300">
          Escenarios listos: <span className="font-medium text-white">{readyScenarioCount} de {scenarioCount}</span>
        </p>
        {(!isBulk && !selectedParticipantId) ? (
          <p className="text-xs text-amber-200">Elige un destinatario para habilitar la creación.</p>
        ) : readyScenarioCount !== scenarioCount || scenarioCount === 0 ? (
          <p className="text-xs text-amber-200">Completa el título y audio de cada escenario antes de crear.</p>
        ) : (
          <p className="text-xs text-slate-400">
            Revisa la selección antes de crear. El servidor validará los permisos y la elegibilidad.
          </p>
        )}
      </section>

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