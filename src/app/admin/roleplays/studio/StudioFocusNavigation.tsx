'use client';

import { formatStudioTime as formatTime, formatStudioAccessibleTime } from '@/lib/roleplay-studio/format-time';

type VisibleTurn = { segment: { id: string; title: string; sourceSpeakerGroup?: string }; index: number };
type Props = {
  visibleSegments: VisibleTurn[];
  focusedTurn: VisibleTurn;
  focusIndex: number;
  totalTurns: number;
  workspaceActive: boolean;
  canConfirmFocused: boolean;
  editingDisabled: boolean;
  confirmed: boolean;
  focusedReviewIssue: string | null;
  sourceProfileCount: number;
  previewActive: boolean;
  playhead: number;
  duration: number;
  onFocusCard: () => void;
  listenAfterConfirm: boolean;
  onListenAfterConfirmChange: (enabled: boolean) => void;
  onSelect: (id: string) => void;
  onConfirm: () => void;
  onExclude: () => void;
  onApplyProfile: () => void;
  onPreview: () => void;
  onPause: () => void;
  onSkip: (seconds: number) => void;
  onSeek: (seconds: number) => void;
};

/** Persistent focus navigation; all audio and editorial operations are delegated. */
export default function StudioFocusNavigation({
  visibleSegments, focusedTurn, focusIndex, totalTurns, workspaceActive,
  canConfirmFocused, editingDisabled, confirmed, focusedReviewIssue, sourceProfileCount,
  previewActive, playhead, duration, onFocusCard, onSelect, onConfirm, onExclude, onApplyProfile,
  onPreview, onPause, onSkip, onSeek, listenAfterConfirm, onListenAfterConfirmChange,
}: Props) {
  return (
    <nav aria-label="Navegador de intervenciones" className={`flex min-w-0 shrink-0 flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--theme-panel)] p-2 ${workspaceActive ? '' : 'md:sticky md:top-0 md:z-10'}`}>
      <button type="button" aria-label="Anterior intervención" disabled={focusIndex === 0}
        onClick={() => onSelect(visibleSegments[focusIndex - 1].segment.id)}
        className="min-h-11 min-w-11 rounded-lg sm:min-h-0 sm:min-w-0 border border-[var(--border)] px-3 py-2 text-xs text-[var(--foreground)] disabled:opacity-50">
        Anterior<span className="hidden sm:inline"> intervención</span>
      </button>
      <label className="min-w-0 flex-1 text-xs text-[var(--text-secondary)]">
        Ir a intervención
        <select value={focusedTurn.segment.id} onChange={event => onSelect(event.currentTarget.value)}
          className="mt-1 block min-h-11 w-full min-w-0 rounded-lg sm:min-h-0 border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] p-2 text-[var(--theme-control-text)]">
          {visibleSegments.map(({ segment, index }) => (
            <option key={segment.id} value={segment.id}>#{index + 1} · {segment.title}</option>
          ))}
        </select>
      </label>
      <button type="button" aria-label="Siguiente intervención" disabled={focusIndex === visibleSegments.length - 1}
        onClick={() => onSelect(visibleSegments[focusIndex + 1].segment.id)}
        className="min-h-11 min-w-11 rounded-lg sm:min-h-0 sm:min-w-0 border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--theme-link)] disabled:opacity-50">
        Siguiente<span className="hidden sm:inline"> intervención</span>
      </button>
      <p role="status" className="basis-full text-xs text-[var(--text-secondary)]">
        Intervención {focusedTurn.index + 1} de {totalTurns} · {focusIndex + 1} de {visibleSegments.length} visibles
      </p>
      <div role="group" aria-label="Reproducción en modo enfoque" className="grid basis-full min-w-0 grid-cols-2 gap-2 border-t border-[var(--border)] pt-2 sm:flex sm:flex-wrap sm:items-center">
        <button type="button" onClick={onPreview}
          aria-pressed={previewActive}
          className="col-span-2 min-h-11 min-w-0 rounded-lg theme-action-primary px-3 py-2 text-xs font-semibold">
          {previewActive
            ? 'Detener fragmento activo' : 'Escuchar intervención activa'}
        </button>
        <button type="button" onClick={onPause}
          className="col-span-2 min-h-11 min-w-0 rounded-lg border border-[var(--border)] px-2 py-2 text-xs text-[var(--foreground)]">
          Pausar audio
        </button>
        <button type="button" aria-label="Retroceder audio 5 segundos"
          onClick={() => onSkip(-5)}
          className="min-h-11 min-w-11 rounded-lg sm:min-h-0 sm:min-w-0 border border-[var(--border)] px-2 py-2 text-xs text-[var(--foreground)]">−5 s</button>
        <button type="button" aria-label="Avanzar audio 5 segundos"
          onClick={() => onSkip(5)}
          className="min-h-11 min-w-11 rounded-lg sm:min-h-0 sm:min-w-0 border border-[var(--border)] px-2 py-2 text-xs text-[var(--foreground)]">+5 s</button>
        <label className="col-span-2 flex w-full min-w-0 basis-full items-center gap-2 text-xs text-[var(--text-secondary)] sm:w-auto sm:min-w-32 sm:basis-auto sm:flex-1">
          <span className="shrink-0 tabular-nums">{formatTime(playhead)}</span>
          <input type="range" aria-label="Posición de grabación en modo enfoque" min={0} max={duration}
            step={0.1} value={Math.min(duration, Math.max(0, playhead))}
            aria-valuetext={formatStudioAccessibleTime(Math.min(duration, Math.max(0, playhead)), 1)}
            onChange={event => onSeek(event.currentTarget.valueAsNumber)}
            className="h-11 min-w-0 flex-1 accent-[var(--theme-link)] sm:h-auto"/>
          <span className="shrink-0 tabular-nums">{formatTime(duration)}</span>
        </label>
      </div>
      <div className="grid basis-full grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <button type="button" disabled={!canConfirmFocused} onClick={onConfirm}
          aria-keyshortcuts="Control+Enter Meta+Enter"
          className="min-h-11 min-w-0 rounded-lg theme-action-primary px-3 py-2 text-sm font-semibold disabled:opacity-50">Confirmar y avanzar</button>
        <button type="button" onClick={onExclude}
          disabled={editingDisabled}
          className="min-h-11 min-w-0 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--theme-danger)] disabled:opacity-50">Excluir y avanzar</button>
        <span className="col-span-2 text-xs text-[var(--text-secondary)]">
          {focusedReviewIssue ?? (confirmed ? 'Confirmada' : 'Lista para revisión')} · Ctrl/⌘ + Enter
        </span>
      </div>
      <label className="flex min-h-11 basis-full cursor-pointer items-center gap-2 text-xs text-[var(--foreground)]">
        <input type="checkbox" checked={listenAfterConfirm} disabled={editingDisabled}
          onChange={event => onListenAfterConfirmChange(event.currentTarget.checked)}
          aria-describedby="studio-next-preview-help"
          className="size-5 shrink-0 accent-[var(--theme-link)]"/>
        Escuchar siguiente al confirmar
      </label>
      <p id="studio-next-preview-help" className="basis-full text-xs text-[var(--text-secondary)]">Solo reproduce el siguiente turno visible sin confirmar, si sus tiempos son válidos. Nunca confirma ni excluye por ti. Se desactiva al cambiar de grabación.</p>
      {focusedTurn.segment.sourceSpeakerGroup && <p className="text-xs text-[var(--text-secondary)]">Etiqueta de origen: {focusedTurn.segment.sourceSpeakerGroup}. Escucha y confirma la voz antes de aplicar el perfil a otros turnos.</p>}
      {sourceProfileCount > 0 && (
        <button type="button" onClick={onApplyProfile}
          disabled={editingDisabled}
          className="min-h-11 min-w-11 rounded-lg sm:min-h-0 sm:min-w-0 theme-action-secondary px-3 py-2 text-xs font-semibold">
          Aplicar perfil a {sourceProfileCount} turnos de la misma etiqueta
        </button>
      )}
      <div className="flex basis-full flex-wrap items-center gap-2">
        <button type="button" onClick={onFocusCard} disabled={editingDisabled}
          className="theme-action-secondary min-h-11 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50">Usar atajos de teclado</button>
        <p id="studio-focused-shortcuts" className="min-w-0 flex-1 text-xs text-[var(--text-secondary)]">
          Con la tarjeta enfocada: Espacio para escuchar o detener; 1 cliente, 2 hispanohablante, 3 intérprete original; ← / → para cambiar de turno. Clasificar no confirma ni excluye.
        </p>
      </div>

    </nav>
  );
}
