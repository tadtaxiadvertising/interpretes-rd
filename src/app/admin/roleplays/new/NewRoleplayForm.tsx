'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Mic2, Loader2, User, UserPlus, AlertCircle, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScenarioCard } from './ScenarioCard';
import { ROLEPLAY_MAX_SCENARIOS, ROLEPLAY_RESPONSE_MAX_DURATION_SEC } from '@/lib/roleplay-limits';
import { prepareRoleplayManifestImport } from '@/lib/roleplay-manifest-import';
import { inspectRoleplayAdminAudioDraft } from '@/lib/roleplay/browser-audio-preflight';
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
// Warning/consent threshold only; not an upload limit or memory guarantee.
// A direct-to-Storage route is still needed for large batches (issue #290).
const LARGE_AUDIO_BATCH_CONFIRM_BYTES = 96 * 1024 * 1024;

function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

// Searches are editorial only: normalize accents without changing IDs or
// stored participant names. This lets "Maria" find "María" in Spanish lists.
function normalizeParticipantSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();
}

export default function NewRoleplayForm({ interpreters, candidates, initialCandidateId, librarySource }: NewRoleplayFormProps) {
  const [participantType, setParticipantType] = useState<'interpreter' | 'candidate' | 'all-active-interpreters'>(initialCandidateId ? 'candidate' : 'interpreter');
  const [selectedParticipantId, setSelectedParticipantId] = useState<string>(initialCandidateId ? String(initialCandidateId) : '');
  const [participantSearch, setParticipantSearch] = useState('');
  const [scenarios, setScenarios] = useState<Scenario[]>([
    { id: INITIAL_SCENARIO_ID, title: '', baseAudioFile: null, baseAudioPreview: '', durationLimitSec: 0, scriptPrompt: '' }
  ]);
  const [isCreating, setIsCreating] = useState(false);
  // Transport failures do not tell us whether the server committed the roleplay.
  const [submissionUncertain, setSubmissionUncertain] = useState(false);
  // A state-driven disabled button updates on render; the ref also prevents
  // duplicate POST requests fired before React commits that render.
  const createPending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ link: string; participantName: string; summary?: string } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [validationFocus, setValidationFocus] = useState<{
    scenarioId: string; field: 'title' | 'audio'; requestId: number;
  } | null>(null);
  const validationFocusSequence = useRef(0);
  // Unlike focus requests, this target survives unrelated edits so a
  // later correction can remove the stale warning without resubmitting.
  const pendingFieldValidation = useRef<{ scenarioId: string; field: 'title' | 'audio'; message: string } | null>(null);
  const [lastRemoved, setLastRemoved] = useState<{ scenario: Scenario; index: number } | null>(null);
  const [bulkResponseLimitSec, setBulkResponseLimitSec] = useState(120);
  // Keep the import identity independent from React render batching. The user
  // can edit a draft while a ZIP/SHA-256 validation is still awaiting.
  const importRevision = useRef(0);
  const importPending = useRef(false);
  // Object URLs are browser resources. Track every preview created by this
  // editor, including previews awaiting React state commits. Releasing only
  // on replace/remove leaks them when navigating away from the form.
  const previewUrls = useRef<Set<string>>(new Set());

  // React state updaters must remain pure; StrictMode can invoke them more
  // than once. Release replaced/removed previews only after a committed render
  // has stopped referencing them (including stale import previews).
  useEffect(() => {
    const active = new Set(scenarios.map(s => s.baseAudioPreview).filter(Boolean));
    for (const url of previewUrls.current) {
      if (!active.has(url)) {
        URL.revokeObjectURL(url);
        previewUrls.current.delete(url);
      }
    }
  }, [scenarios]);

  useEffect(() => {
    // Capture the current Set once; cleanup should release the URLs owned by
    // this mount even if the ref is later reassigned.
    const ownedPreviewUrls = previewUrls.current;
    return () => {
      // Cancel async ZIP/SHA-256 work from committing after unmount.
      importRevision.current += 1;
      importPending.current = false;
      for (const url of ownedPreviewUrls) URL.revokeObjectURL(url);
      ownedPreviewUrls.clear();
    };
  }, []);

  const invalidatePendingImport = useCallback(() => {
    setImportNotice(null);
    setValidationFocus(null);
    // Undo only the most recent deletion; subsequent edits invalidate it.
    setLastRemoved(null);
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
  const search = normalizeParticipantSearch(participantSearch);
  const matchingParticipants = search
    ? participants.filter((participant) => [
        participant.name, participant.email, participant.externalId, participant.emailCorporativo,
      ].some((value) => normalizeParticipantSearch(value ?? '').includes(search)))
    : participants;
  // Do not silently drop the selected option when the administrator searches
  // for someone else: the user should explicitly choose a different target.
  const visibleParticipants = selectedParticipant &&
    !matchingParticipants.some((participant) => participant.id === selectedParticipant.id)
    ? [selectedParticipant, ...matchingParticipants] : matchingParticipants;
  const scenarioCount = librarySource?.scenarios.length ?? scenarios.length;
  const readyScenarioCount = librarySource?.scenarios.length ??
    scenarios.filter((scenario) => scenario.title.trim() && scenario.baseAudioFile).length;
  // Preview only; never materialize file bytes and never replace server limits.
  const selectedAudioBytes = librarySource ? 0 :
    scenarios.reduce((bytes, scenario) => bytes + (scenario.baseAudioFile?.size ?? 0), 0);
  const defaultResponseLimitCount = librarySource ? 0 :
    scenarios.filter(scenario => scenario.durationLimitSec === 0).length;

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

  const applyResponseLimitToDefaultScenarios = () => {
    if (!Number.isSafeInteger(bulkResponseLimitSec) || bulkResponseLimitSec < 1 ||
        bulkResponseLimitSec > ROLEPLAY_RESPONSE_MAX_DURATION_SEC) return;
    // The bulk action is opt-in and does not overwrite individual limits or
    // alter validated audio SHA-256 values, metadata, or prompt content.
    invalidatePendingImport();
    setScenarios(previous => previous.map(scenario =>
      scenario.durationLimitSec === 0
        ? { ...scenario, durationLimitSec: bulkResponseLimitSec }
        : scenario,
    ));
    setError(null);
  };

  const removeScenario = useCallback((id: string) => {
    const index = scenarios.findIndex(scenario => scenario.id === id);
    if (index === -1) return;
    const removed = scenarios[index];
    invalidatePendingImport();
    setLastRemoved({ scenario: removed, index });
    setScenarios(prev => prev.filter(scenario => scenario.id !== id));
  }, [invalidatePendingImport, scenarios]);

  const restoreRemovedScenario = () => {
    if (!lastRemoved) return;
    if (scenarios.length >= ROLEPLAY_MAX_SCENARIOS ||
        scenarios.some(scenario => scenario.id === lastRemoved.scenario.id)) {
      setLastRemoved(null);
      return;
    }
    // Removal releases the previous blob URL after the React commit. A new
    // local object URL is needed for undo; never reuse a revoked resource.
    const original = lastRemoved.scenario;
    const restoredPreview = original.baseAudioFile
      ? URL.createObjectURL(original.baseAudioFile)
      : '';
    if (restoredPreview) previewUrls.current.add(restoredPreview);
    const restored = { ...original, baseAudioPreview: restoredPreview };
    invalidatePendingImport();
    setScenarios(previous => {
      const next = [...previous];
      next.splice(Math.min(lastRemoved.index, next.length), 0, restored);
      return next;
    });
    setLastRemoved(null);
    setError(null);
  };

  const updateScenario = useCallback((id: string, updates: Partial<Scenario>) => {
    const pending = pendingFieldValidation.current;
    const resolvedValidationField = pending?.scenarioId === id && (
      (pending.field === 'title' && typeof updates.title === 'string' && updates.title.trim().length > 0) ||
      (pending.field === 'audio' && Boolean(updates.baseAudioFile))
    );
    invalidatePendingImport();
    // Clear a resolved, local validation warning immediately, but never hide
    // an upload, import, permission or publication error from the server.
    if (resolvedValidationField) {
      pendingFieldValidation.current = null;
      setError(previous => previous === pending?.message ? null : previous);
    }
    // Track new URLs before state commits so unmount can still release them.
    if (updates.baseAudioPreview?.startsWith('blob:')) previewUrls.current.add(updates.baseAudioPreview);
    setScenarios(prev => prev.map(scenario =>
      scenario.id === id ? { ...scenario, ...updates } : scenario
    ));
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
    setLastRemoved(null);
    setError(null);
    setImportNotice(null);
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
      // A validated package already loaded with identical editorial metadata
      // must be a no-op: no replacement prompt, new blob URLs or lost focus.
      // SHA-256 is required so manually replaced audio can never count as the
      // same package solely because its filename happens to match.
      const identicalPackage = scenarios.length === prepared.length &&
        scenarios.every((current, index) => {
          const incoming = prepared[index];
          return Boolean(current.sha256) &&
            current.sha256 === incoming.sha256 &&
            current.baseAudioFile?.name === incoming.baseAudioFile.name &&
            current.title === incoming.title &&
            current.durationLimitSec === incoming.durationLimitSec &&
            current.scriptPrompt === incoming.scriptPrompt &&
            (current.studioTurn ?? null) === (incoming.studioTurn ?? null) &&
            (current.studioSpeaker ?? null) === (incoming.studioSpeaker ?? null) &&
            (current.studioLanguage ?? null) === (incoming.studioLanguage ?? null) &&
            (current.sourceStartSec ?? null) === (incoming.sourceStartSec ?? null) &&
            (current.sourceEndSec ?? null) === (incoming.sourceEndSec ?? null);
        });
      if (identicalPackage) {
        setImportNotice('Este paquete ya está importado y no tiene cambios. Conservamos los escenarios existentes.');
        return;
      }
      // A first import into the empty form stays one-click. A prepared package
      // must not silently erase a draft containing manual work; ask only
      // after all ZIP, manifest and checksum checks have passed.
      const hasEditedDraft = scenarios.length > 1 || scenarios.some((scenario) =>
        Boolean(scenario.title.trim()) ||
        Boolean(scenario.baseAudioFile) ||
        Boolean(scenario.scriptPrompt.trim()) ||
        scenario.durationLimitSec > 0,
      );
      if (hasEditedDraft && !window.confirm(
        'El paquete está verificado, pero importarlo reemplazará los escenarios que ya editaste. ' +
        'Guarda tu trabajo antes de continuar. ¿Reemplazar el borrador?',
      )) {
        setError('Importación cancelada. El borrador anterior se conservó.');
        return;
      }
      if (revision !== importRevision.current) return;
      const next = prepared.map((scenario) => {
        const baseAudioPreview = URL.createObjectURL(scenario.baseAudioFile);
        previewUrls.current.add(baseAudioPreview);
        return { ...scenario, id: generateId(), baseAudioPreview };
      });
      // Do not mutate browser resources inside the state updater: it may be
      // replayed. Even when an import becomes stale while React is batching,
      // return a new unchanged array to schedule orphan preview cleanup.
      setScenarios(prev => revision === importRevision.current ? next : [...prev]);
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
      pendingFieldValidation.current = null;
      setError('Selecciona el intérprete o candidato que recibirá el roleplay.');
      document.getElementById('roleplay-participant-select')?.focus();
      return false;
    }
    if (librarySource) {
      if (librarySource.scenarios.length === 0) {
        setError('La plantilla no contiene escenarios. Elige otra plantilla antes de asignar.');
        return false;
      }
      return true;
    }
    if (scenarios.length === 0 || scenarios.length > ROLEPLAY_MAX_SCENARIOS) {
      setError(`Agrega entre 1 y ${ROLEPLAY_MAX_SCENARIOS} escenarios antes de crear el roleplay.`);
      return false;
    }
    for (const [index, scenario] of scenarios.entries()) {
      if (!scenario.title.trim()) {
        const message = `El escenario ${index + 1} necesita un título.`;
        pendingFieldValidation.current = { scenarioId: scenario.id, field: 'title', message };
        setError(message);
        setValidationFocus({
          scenarioId: scenario.id, field: 'title', requestId: ++validationFocusSequence.current,
        });
        return false;
      }
      if (!scenario.baseAudioFile) {
        const message = `El escenario ${index + 1} necesita un audio válido.`;
        pendingFieldValidation.current = { scenarioId: scenario.id, field: 'audio', message };
        setError(message);
        setValidationFocus({
          scenarioId: scenario.id, field: 'audio', requestId: ++validationFocusSequence.current,
        });
        return false;
      }
    }
    // A manifest may have changed after import, or another component may
    // supply an audio that bypasses the card's selection-time validation.
    // Reject it before constructing or transferring a potentially huge body.
    const preflight = inspectRoleplayAdminAudioDraft(scenarios);
    if (preflight.invalid) {
      const { index, message } = preflight.invalid;
      const scenario = scenarios[index];
      pendingFieldValidation.current = scenario ? { scenarioId: scenario.id, field: 'audio', message } : null;
      setError(message);
      if (scenario) setValidationFocus({
        scenarioId: scenario.id, field: 'audio', requestId: ++validationFocusSequence.current,
      });
      return false;
    }
    pendingFieldValidation.current = null;
    return true;
  };

  const handleCreate = async () => {
    if (createPending.current || !validateForm()) return;
    // A large legacy multipart request may exhaust the small Next.js VPS.
    // Ask before constructing FormData or posting any bytes. Declining must
    // preserve all edited clips, their order and the selected participant.
    if (!librarySource && selectedAudioBytes > LARGE_AUDIO_BATCH_CONFIRM_BYTES &&
        !window.confirm(
          `Estás a punto de enviar ${(selectedAudioBytes / (1024 * 1024)).toFixed(1)} MiB de audio al servidor. ` +
          'En un servidor con memoria limitada, una carga tan grande podría interrumpir el servicio. ' +
          'Puedes cancelar y reutilizar una plantilla de la biblioteca, si ya existe. ' +
          '¿Confirmas enviar estos archivos ahora?',
        )) return;
    createPending.current = true;

    setIsCreating(true);
    setError(null);
    setSubmissionUncertain(false);

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

      // A network failure or an unreadable response may happen after the DB
      // transaction committed. Do not imply the request definitely failed.
      const unknownResultMessage = 'No se pudo confirmar el resultado de la creación.';
      let res: Response;
      try {
        res = await fetch('/api/admin/roleplays', {
          method: 'POST',
          body: formData,
        });
      } catch {
        setSubmissionUncertain(true);
        throw new Error(unknownResultMessage);
      }

      // A 5xx may be returned after a successful DB commit (or after
      // losing its acknowledgment). Even a JSON success:false at this
      // status is not proof that publishing was rolled back. Likewise, a
      // transport/proxy error must never echo its body in the UI.
      if (typeof res.status === 'number' && res.status >= 500) {
        setSubmissionUncertain(true);
        throw new Error(unknownResultMessage);
      }

      let raw: unknown;
      try {
        raw = await res.json();
      } catch {
        setSubmissionUncertain(true);
        throw new Error(unknownResultMessage);
      }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
          typeof (raw as { success?: unknown }).success !== 'boolean' ||
          ((raw as { success: boolean }).success &&
            (!(raw as { data?: unknown }).data ||
             typeof (raw as { data?: unknown }).data !== 'object' ||
             Array.isArray((raw as { data?: unknown }).data)))) {
        setSubmissionUncertain(true);
        throw new Error(unknownResultMessage);
      }

      const data = raw as {
        success: boolean;
        error?: unknown;
        data?: {
          bulk?: boolean;
          createdCount?: number;
          skippedCount?: number;
          scenarioCount?: number;
          inviteLink?: string;
          sessionId?: string;
        };
      };
      if (!data.success) {
        throw new Error(typeof data.error === 'string' && data.error.trim()
          ? data.error : 'El servidor rechazó la creación del roleplay.');
      }
      // A non-error HTTP status must not manufacture a success view when
      // the backend's session identity / bulk counters are missing. Keep
      // compatibility with older single-session responses providing either
      // an inviteLink or a sessionId.
      const payload = data.data;
      const validBulk = payload?.bulk === true &&
        Number.isSafeInteger(payload.createdCount) && (payload.createdCount ?? 0) > 0 &&
        Number.isSafeInteger(payload.skippedCount) && (payload.skippedCount ?? -1) >= 0 &&
        Number.isSafeInteger(payload.scenarioCount) && (payload.scenarioCount ?? 0) > 0 &&
        (payload.scenarioCount ?? 0) <= ROLEPLAY_MAX_SCENARIOS;
      const validSingle = (payload?.bulk === undefined || payload?.bulk === false) &&
        ((typeof payload?.inviteLink === 'string' && payload.inviteLink.trim().length > 0) ||
          (typeof payload?.sessionId === 'string' && payload.sessionId.trim().length > 0));
      if (!payload || res.ok === false || (!validBulk && !validSingle)) {
        setSubmissionUncertain(true);
        throw new Error(unknownResultMessage);
      }

      if (payload.bulk) {
        setSuccess({
          link: `${window.location.origin}/admin/roleplays`,
          participantName: `${payload.createdCount} active interpreter(s)`,
          summary: `${payload.createdCount} sesiones creadas · ${payload.skippedCount} omitidas. ${payload.scenarioCount} escenarios ${librarySource ? 'reutilizados desde la biblioteca' : 'subidos una vez y compartidos entre sesiones'}.`,
        });
      } else {
        setSuccess({
          link: payload.inviteLink || `${window.location.origin}/roleplays/${payload.sessionId}`,
          participantName: participantType === 'interpreter'
            ? interpreters.find(i => i.id === parseInt(selectedParticipantId))?.name || 'Intérprete'
            : candidates.find(c => c.id === parseInt(selectedParticipantId))?.name || 'Candidato',
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create roleplay');
    } finally {
      createPending.current = false;
      setIsCreating(false);
    }
  };


  if (success) {
    return (
      <div className="glass p-8 rounded-3xl border border-white/5 text-center animate-in fade-in">
        <div className="w-20 h-20 bg-green-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <Mic2 size={40} className="text-green-400" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">{success.summary ? 'Roleplays creados correctamente' : '¡Roleplay creado correctamente!'}</h2>
        <p className="text-gray-400 mb-6">
          Creado para <span className="font-bold text-white">{success.participantName}</span>
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
            Copiar enlace
          </button>
          <Link 
            href="/admin/roleplays"
            className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-bold transition-colors"
          >
            Ver todos los roleplays
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
          <p className="mt-2 text-xs text-blue-100">
            Los .md de HappyScribe son transcripciones; los JSON de proyecto guardan
            cortes de edición. Ninguno se puede asignar directamente. Abre Audio Studio,
            importa el SRT desde HappyScribe, revisa los turnos y genera un ZIP con
            manifest.json y los MP3. Si descargaste un proyecto JSON en modo local,
            ábrelo junto a la grabación original y genera el ZIP con el exportador local.
          </p>
          <Link href="/admin/roleplays/studio"
            className="mt-2 inline-block text-xs font-semibold text-blue-200 underline underline-offset-2">
            Preparar paquete en Audio Studio
          </Link>
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
          {importNotice && <p role="status" className="mt-2 text-sm text-emerald-200">{importNotice}</p>}
        </div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white">Escenarios ({scenarios.length}/{ROLEPLAY_MAX_SCENARIOS})</h3>
          <button
            onClick={addScenario}
            disabled={scenarios.length >= ROLEPLAY_MAX_SCENARIOS}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus size={18} />
            Añadir escenario
          </button>
        </div>

        {defaultResponseLimitCount >= 2 && (
          <div className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-white/10 bg-slate-950/50 p-3">
            <label htmlFor="roleplay-bulk-response-limit" className="flex-1 min-w-44 text-sm text-slate-200">
              Tiempo de respuesta para {defaultResponseLimitCount} escenarios sin límite personalizado
              <select id="roleplay-bulk-response-limit" value={bulkResponseLimitSec}
                onChange={event => setBulkResponseLimitSec(Number(event.target.value))}
                className="mt-1 block w-full rounded-lg border border-white/15 bg-slate-900 px-3 py-2 text-sm text-white">
                <option value={60}>1 minuto</option>
                <option value={90}>1 minuto y medio</option>
                <option value={120}>2 minutos</option>
                <option value={180}>3 minutos</option>
                <option value={300}>5 minutos</option>
              </select>
            </label>
            <button type="button" onClick={applyResponseLimitToDefaultScenarios}
              className="rounded-lg border border-blue-400/30 px-3 py-2 text-sm font-medium text-blue-200 hover:bg-blue-500/10">
              Aplicar solo a los sin configurar
            </button>
          </div>
        )}
        {lastRemoved && (
          <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-400/20 bg-amber-400/5 px-3 py-2">
            <p className="text-sm text-amber-100">Escenario eliminado. Puedes recuperar sus datos y audio antes de editar otra cosa.</p>
            <button type="button" onClick={restoreRemovedScenario}
              className="rounded-lg border border-amber-300/30 px-3 py-1.5 text-sm font-semibold text-amber-100 hover:bg-amber-400/10">
              Deshacer eliminación de escenario
            </button>
          </div>
        )}
        <div className="space-y-4">
          {scenarios.map((scenario, index) => (
            <div key={scenario.id} className="group" onDragStart={() => setDraggingId(scenario.id)} onDragEnd={() => setDraggingId(null)}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-medium text-gray-400">Escenario {index + 1}</span>
                <span className="text-xs text-gray-500">(usa las flechas para cambiar el orden)</span>
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
                startCollapsed={scenarios.length >= 4 && Boolean(scenario.sha256 && scenario.baseAudioFile)}
                focusRequest={validationFocus?.scenarioId === scenario.id ? validationFocus : null}
              />
            </div>
          ))}
          
          {scenarios.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              No hay escenarios. Pulsa «Añadir escenario» para empezar.
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
        {!librarySource && selectedAudioBytes > 0 && (
          <p className="text-sm text-slate-300">
            Audio seleccionado: <span className="font-medium text-white">{(selectedAudioBytes / (1024 * 1024)).toFixed(1)} MiB</span>
          </p>
        )}
        {!librarySource && selectedAudioBytes > LARGE_AUDIO_BATCH_CONFIRM_BYTES && (
          <div className="space-y-1 text-xs text-amber-200">
            <p>
              Este lote es voluminoso. La publicación actual envía los audios al servidor;
              se solicitará tu confirmación antes de transferirlos. Una carga grande puede
              agotar la memoria del VPS. Si se interrumpe, comprueba primero la lista de
              roleplays antes de repetir la operación.
            </p>
            <Link href="/admin/roleplays/library"
              className="inline-block font-semibold underline underline-offset-2">
              Reutilizar audio desde la biblioteca (sin volver a subirlo)
            </Link>
          </div>
        )}
        {(!isBulk && !selectedParticipantId) ? (
          <p className="text-xs text-amber-200">Elige un destinatario antes de crear. El formulario te llevará al primer dato pendiente.</p>
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
      {submissionUncertain && (
        <p role="status" className="rounded-xl border border-amber-400/25 bg-amber-400/5 px-4 py-3 text-sm text-amber-100">
          El servidor no pudo confirmar la operación o se interrumpió la conexión. El roleplay podría haberse creado.
          {' '}<Link href="/admin/roleplays" className="font-semibold underline underline-offset-2">
            Comprobar los roleplays existentes
          </Link>{' '}antes de volver a enviar los audios.
        </p>
      )}

      <button
        onClick={handleCreate}
        disabled={isCreating || isImporting}
        className={cn(
          "w-full py-4 rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-3",
          isCreating || isImporting
            ? "bg-slate-800 text-slate-500 cursor-not-allowed"
            : "bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/20"
        )}
      >
        {isCreating ? <><Loader2 className="animate-spin" size={24} /> Creando...</> : <><Mic2 size={24} /> {librarySource ? 'Asignar plantilla' : isBulk ? 'Crear para todos los intérpretes activos' : 'Crear roleplay'}</>}
      </button>
    </div>
  );
}