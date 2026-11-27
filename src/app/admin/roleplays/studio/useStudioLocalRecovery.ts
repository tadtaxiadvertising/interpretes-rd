'use client';

import { useEffect, useRef, useState } from 'react';
import { STUDIO_RECOVERY_KEY, createStudioRecovery, openStudioRecovery, mergeProductionReceipts, type RecoveryProductionReceipt } from '@/lib/roleplay-studio/recovery';
import { fingerprintLocalMedia } from '@/lib/roleplay-studio/long-media';
import { productionReceipts, restoreProductionReceipts } from '@/lib/roleplay-studio/production-tracking';
import type { StudioIntervention as Segment } from './StudioInterventionCard';

export type RestoredStudioRecovery = ReturnType<typeof openStudioRecovery>;

type Options = {
  audio: File | null;
  duration: number;
  segments: Segment[];
  excludedTurns: Array<{turn: Segment; caption?: string}>;
  confirmedIds: ReadonlySet<string>;
  workspaceTurnId: string | undefined;
  activeProductionKeys: ReadonlyMap<string,string> | null;
  activeAudioFile: {current: File | null};
  editorRevision: {current: number};
  player: {current: HTMLMediaElement | null};
  disabled: boolean;
  hasActiveEditorWork: boolean;
  onRestore: (saved: RestoredStudioRecovery) => void;
};

/** Owns only the opt-in local backup lifecycle. Applying restored editor
 * state, playback, and publication remain responsibilities of the editor. */
export function useStudioLocalRecovery({
  audio,duration,segments,excludedTurns,confirmedIds,workspaceTurnId,activeProductionKeys,
  activeAudioFile,editorRevision,player,disabled,hasActiveEditorWork,onRestore,
}: Options) {
  const [recoveryEnabled, setRecoveryEnabled] = useState(false);
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const [recoveryStatus, setRecoveryStatus] = useState('');
  const [recoveryFingerprint, setRecoveryFingerprint] = useState<{file: File; hash: string} | null>(null);
  const recoveryExpected = useRef<string | null>(null);
  const recoveryOperation = useRef(0);
  const recoveryReceipts = useRef<RecoveryProductionReceipt[]>([]);
  const flushRecovery = useRef<(() => string | undefined) | null>(null);

  useEffect(() => {
    const refresh = () => {
      try { setRecoveryAvailable(localStorage.getItem(STUDIO_RECOVERY_KEY) !== null); }
      catch { setRecoveryStatus('El navegador no permite guardar respaldos locales.'); }
    };
    refresh();
    window.addEventListener('storage', refresh);
    return () => {
      recoveryOperation.current += 1;
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const resetRecoveryForSource = () => {
    recoveryOperation.current += 1;
    setRecoveryEnabled(false);
    setRecoveryFingerprint(null);
    recoveryReceipts.current = [];
    setRecoveryStatus('');
  };

  const startRecovery = async (restore: boolean) => {
    if (!audio || !duration || disabled) return;
    const source = audio;
    const revision = editorRevision.current;
    const operation = ++recoveryOperation.current;
    try {
      const raw = localStorage.getItem(STUDIO_RECOVERY_KEY);
      if (restore && !raw) throw new Error('No hay respaldo local disponible.');
      if (!restore && raw) throw new Error('Ya existe un respaldo. Recupéralo o elimínalo explícitamente antes de activar otro.');
      if (restore && hasActiveEditorWork && !window.confirm('Recuperar el respaldo reemplazará el trabajo actual. ¿Continuar?')) return;
      setRecoveryStatus('Verificando grabación…');
      const hash = await fingerprintLocalMedia(source);
      if (operation !== recoveryOperation.current || activeAudioFile.current !== source) return;
      if (revision !== editorRevision.current) {
        setRecoveryStatus('El proyecto cambió durante la verificación. Inténtalo de nuevo.');
        return;
      }
      if (localStorage.getItem(STUDIO_RECOVERY_KEY) !== raw) throw new Error('El respaldo cambió en otra pestaña. Inténtalo de nuevo.');
      if (restore && raw) {
        const saved = openStudioRecovery(raw, source.size, hash, duration);
        onRestore(saved);
        recoveryReceipts.current = saved.production;
        restoreProductionReceipts(saved.production);
      }
      if (!restore) recoveryReceipts.current = [];
      recoveryExpected.current = raw;
      setRecoveryFingerprint({ file: source, hash });
      setRecoveryEnabled(true);
      setRecoveryStatus(restore ? 'Respaldo recuperado.' : 'Guardado local activado.');
    } catch (cause) {
      if (operation === recoveryOperation.current) setRecoveryStatus(cause instanceof Error ? cause.message : 'No fue posible verificar el respaldo.');
    }
  };

  const pauseRecovery = () => {
    recoveryOperation.current += 1;
    setRecoveryEnabled(false);
    setRecoveryStatus('Guardado pausado; se conserva el respaldo.');
  };

  const clearRecovery = () => {
    if (!window.confirm('¿Eliminar el respaldo local de este navegador? El proyecto abierto no se modificará.')) return;
    recoveryOperation.current += 1;
    setRecoveryEnabled(false);
    setRecoveryFingerprint(null);
    try {
      localStorage.removeItem(STUDIO_RECOVERY_KEY);
      recoveryExpected.current = null;
      recoveryReceipts.current = [];
      setRecoveryAvailable(false);
      setRecoveryStatus('Respaldo local eliminado.');
    } catch { setRecoveryStatus('No se pudo eliminar el respaldo local.'); }
  };

  useEffect(() => {
    if (!recoveryEnabled || !audio || recoveryFingerprint?.file !== audio || !duration) return;
    const operation = recoveryOperation.current;
    const write = () => {
      if (operation !== recoveryOperation.current || activeAudioFile.current !== audio) return;
      try {
        if (localStorage.getItem(STUDIO_RECOVERY_KEY) !== recoveryExpected.current) {
          recoveryOperation.current += 1;
          setRecoveryEnabled(false);
          setRecoveryAvailable(localStorage.getItem(STUDIO_RECOVERY_KEY) !== null);
          setRecoveryStatus('Guardado detenido: el respaldo cambió en otra pestaña.');
          return;
        }
        const receipts = mergeProductionReceipts(recoveryReceipts.current, productionReceipts(activeProductionKeys?.values() ?? []));
        const raw = createStudioRecovery(audio.size, recoveryFingerprint.hash, duration, segments,
          confirmedIds, workspaceTurnId, player.current?.currentTime ?? 0, excludedTurns.map(entry => entry.turn), receipts);
        localStorage.setItem(STUDIO_RECOVERY_KEY, raw);
        recoveryExpected.current = raw;
        recoveryReceipts.current = receipts;
        setRecoveryAvailable(true);
        setRecoveryStatus('Respaldo local actualizado.');
        return raw;
      } catch {
        setRecoveryStatus('Cambios sin respaldar: revisa cortes, títulos, tamaño del proyecto o almacenamiento. Se conserva el último respaldo válido.');
      }
    };
    flushRecovery.current = write;
    const timer = window.setTimeout(write, 650);
    const flush = () => { if (document.visibilityState === 'hidden') write(); };
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', write);
    return () => {
      if (flushRecovery.current === write) flushRecovery.current = null;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', write);
    };
  }, [recoveryEnabled, recoveryFingerprint, audio, duration, segments, confirmedIds, workspaceTurnId, excludedTurns, activeProductionKeys, activeAudioFile, player]);

  return {
    recoveryEnabled,recoveryAvailable,recoveryStatus,resetRecoveryForSource,
    startRecovery,pauseRecovery,clearRecovery,flushRecovery,
  };
}
