'use client';

import { memo } from 'react';
import { Trash2 } from 'lucide-react';
import { ROLEPLAY_RESPONSE_MAX_DURATION_SEC } from '@/lib/roleplay-limits';
import { formatStudioTime as formatTime } from '@/lib/roleplay-studio/format-time';
import { studioSelectedSeconds, type StudioCutRange } from '@/lib/roleplay-studio/compound-cuts';
import { makeNeutralSegmentTitle, studioEditorialProfile, studioProfileSelection, type StudioLanguage, type StudioSpeakerRole } from '@/lib/roleplay-studio/speaker-profiles';
import type { BoundaryProposal } from '@/lib/roleplay-studio/boundary-proposals';

export type StudioIntervention = {
  id: string;
  title: string;
  start: number;
  end: number;
  scriptPrompt: string;
  responseLimit: number;
  speakerRole: StudioSpeakerRole;
  language: StudioLanguage;
  ranges?: StudioCutRange[];
  // Private, in-memory provider label; never serialized into projects or packages.
  sourceSpeakerGroup?: string;
};
type Segment = StudioIntervention;
type Props = {
  segment: Segment;
  index: number;
  nextTurn?: Segment;
  canPreviewPair: boolean;
  caption?: string;
  compactRows: boolean;
  focusMode: boolean;
  expandedSegmentId: string | null;
  advancedTurnId: string | null;
  turnActionFeedback: {id: string; message: string; error: boolean} | null;
  boundaryProposal: BoundaryProposal | null;
  canUseBoundaryProposal: boolean;
  proposalPreviewId: string;
  previewingId: string | null;
  pairPreviewId: string | null;
  duration: number;
  seekAudio: (seconds: number) => void;
  splitAtPlayhead: (id: string) => void;
  mergeWithNext: (id: string) => void;
  separateCompound: (id: string) => void;
  previewPairWithoutGap: (id: string) => void;
  previewSegment: (segment: Segment) => void;
  removeIntervention: (id: string) => void;
  update: (id: string, patch: Partial<Segment>) => void;
  insertProtocol: (segment: Segment) => void;
  markAtPlayhead: (id: string, boundary: 'start' | 'end') => void;
  applyBoundaryProposal: () => void;
  onToggleExpanded: (id: string) => void;
  onToggleAdvanced: (id: string) => void;
};

export type StudioCardActions = Pick<Props,
  'seekAudio' | 'splitAtPlayhead' | 'mergeWithNext' | 'separateCompound' |
  'previewPairWithoutGap' | 'previewSegment' | 'removeIntervention' | 'update' |
  'insertProtocol' | 'markAtPlayhead' | 'applyBoundaryProposal' | 'onToggleExpanded' | 'onToggleAdvanced'>;

/** Controlled editorial card. The parent owns validation, snapshots and audio. */
function StudioInterventionCard({
  segment,index,nextTurn,canPreviewPair,caption,compactRows,focusMode,expandedSegmentId,
  advancedTurnId,turnActionFeedback,boundaryProposal,canUseBoundaryProposal,proposalPreviewId,
  previewingId,pairPreviewId,duration,seekAudio,splitAtPlayhead,mergeWithNext,separateCompound,
  previewPairWithoutGap,previewSegment,removeIntervention,update,insertProtocol,markAtPlayhead,
  applyBoundaryProposal,onToggleExpanded,onToggleAdvanced,
}: Props) {
  // Keep legacy persisted roles compatible while presenting three editorial profiles.
  const profile = studioEditorialProfile(segment.speakerRole);
  const activeProfile = profile?.role ?? null;
  const profileButtons = (
    <div data-review-field="profile" role="group" aria-label={'Perfil de intervención ' + (index + 1)} className="grid w-full min-w-0 grid-cols-2 gap-2 sm:grid-cols-3">
      {([
        ['doctor', 'en', 'Cliente'],
        ['patient', 'es', 'Hispanohablante'],
        ['interpreter', 'en', 'Intérprete original — excluir'],
      ] as const).map(([speakerRole, language, label]) => (
        <button key={speakerRole} type="button"
          aria-pressed={activeProfile === speakerRole && segment.language === language}
          onClick={() => update(segment.id, studioProfileSelection(segment.speakerRole, speakerRole))}
          className={`min-h-11 min-w-0 whitespace-normal break-words rounded-lg border px-2 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-focus)] ${speakerRole === 'interpreter' ? 'col-span-2 sm:col-span-1' : ''} ${activeProfile === speakerRole && segment.language === language ? 'theme-action-primary' : 'theme-action-secondary'}`}>
          {label} · {language.toUpperCase()}
        </button>
      ))}
      {(!activeProfile || segment.language !== profile?.language) && (
        <span className="col-span-full text-xs text-[var(--theme-warning)]">Perfil o idioma pendiente de revisar</span>
      )}
    </div>
  );
  const turnTools = (<div role="group" aria-label={'Herramientas de intervención ' + (index + 1)} className="flex w-full min-w-0 flex-wrap items-center gap-2">
        <button type="button" onClick={() => seekAudio(segment.start)}
        aria-label={'Ir al inicio de intervención ' + (index + 1)}
        className="min-h-11 min-w-0 rounded-md border border-[var(--theme-control-border)] px-3 py-2 text-xs text-[var(--foreground)] hover:bg-[var(--theme-hover)]">
        Ir al inicio
      </button>
      <button type="button" onClick={() => splitAtPlayhead(segment.id)}
        disabled={Boolean(segment.ranges)}
        aria-label={'Dividir intervención ' + (index + 1) + ' en cursor o punto medio'}
        title={segment.ranges ? 'Separa los dos cortes antes de dividir' : 'Divide en cursor o punto medio'}
        className="min-h-11 min-w-0 rounded-md border border-[var(--theme-control-border)] px-3 py-2 text-xs text-[var(--foreground)] hover:bg-[var(--theme-hover)]">
        Dividir
      </button>
      <button type="button" onClick={() => mergeWithNext(segment.id)}
        disabled={Boolean(segment.ranges)}
        aria-label={'Unir intervención ' + (index + 1) + ' con siguiente'}
        title={segment.ranges ? 'Separa los dos cortes antes de añadir otro' : 'Une con el siguiente turno visible; omite pausas largas en el MP3 local'}
        className="min-h-11 min-w-0 rounded-md border border-[var(--theme-control-border)] px-3 py-2 text-xs text-[var(--foreground)] hover:bg-[var(--theme-hover)]">
        {nextTurn &&
          nextTurn.start - segment.end > 2 ? 'Unir sin pausa' : 'Unir'}
      </button>
      {segment.ranges && (
        <button type="button" data-review-field="separate" onClick={() => separateCompound(segment.id)}
          aria-label={'Separar cortes de intervención ' + (index + 1)}
          className="min-h-11 min-w-0 rounded-md border border-[var(--theme-control-border)] px-3 py-2 text-xs text-[var(--theme-warning)]">
          Separar cortes
        </button>
      )}
      {nextTurn && canPreviewPair && (
          <button type="button"
            onClick={() => previewPairWithoutGap(segment.id)}
            aria-label={'Preescuchar intervenciones ' + (index + 1) + ' y ' + (index + 2) + ' sin pausa'}
            aria-pressed={pairPreviewId === segment.id}
            title="Preescucha dos cortes; usa Unir sin pausa para generar una intervención física en el proyecto v2"
            className="min-h-11 min-w-0 rounded-md border border-[var(--theme-control-border)] px-3 py-2 text-xs text-[var(--theme-info)] hover:bg-[var(--theme-hover)]">
            {pairPreviewId === segment.id ? 'Detener preescucha' : 'Escuchar sin pausa'}
          </button>
        )}
      {compactRows && (
        <>
          <button type="button" onClick={() => previewSegment(segment)}
            aria-label={segment.ranges
              ? `${pairPreviewId === segment.id ? 'Detener unión' : 'Escuchar unido'} de intervención ${index + 1}`
              : `${previewingId === segment.id ? 'Detener fragmento' : 'Escuchar fragmento'} de intervención ${index + 1}`}
            className="min-h-11 min-w-0 rounded-md border border-[var(--theme-control-border)] px-3 py-2 text-xs text-[var(--theme-success)]">
            {segment.ranges
              ? pairPreviewId === segment.id ? 'Detener unión' : 'Escuchar unido'
              : previewingId === segment.id ? 'Detener fragmento' : 'Escuchar fragmento'}
          </button>
          <button type="button" onClick={() =>
            onToggleExpanded(segment.id)}
            aria-expanded={expandedSegmentId === segment.id}
            className="min-h-11 min-w-0 rounded-md border border-[var(--theme-control-border)] px-3 py-2 text-xs text-[var(--theme-link)]">
            {expandedSegmentId === segment.id ? 'Contraer' : 'Editar'}
          </button>
        </>
      )}
      <button type="button" aria-label={'Quitar intervención ' + (index + 1)} onClick={() => removeIntervention(segment.id)}
        className="ml-auto inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-[var(--theme-control-border)] p-2 text-[var(--theme-danger)] hover:bg-[var(--theme-hover)]"><Trash2 size={16} aria-hidden="true"/></button>
    </div>);
  return (
  <article key={segment.id} id={`studio-intervention-${segment.id}`} tabIndex={focusMode ? 0 : -1}
    aria-describedby={focusMode ? "studio-focused-shortcuts" : undefined}
    aria-keyshortcuts={focusMode ? "Space 1 2 3 ArrowLeft ArrowRight" : undefined}
    className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--theme-surface-muted)] p-2.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--theme-focus)]">
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="min-w-0 flex-1 break-words text-sm font-semibold text-[var(--foreground)]">
        #{index + 1} · {segment.title}
        <span className="block break-words text-xs font-normal text-[var(--text-secondary)]">
          {segment.ranges
            ? segment.ranges.map(range => formatTime(range.start) + '–' + formatTime(range.end)).join(' + ')
            : formatTime(segment.start) + '–' + formatTime(segment.end)}
          {' · '}{profile?.label ?? 'Sin perfil'} · {segment.language === 'unknown' ? 'Idioma pendiente' : segment.language.toUpperCase()}
        </span>
        {caption && compactRows && (
          <span className="mt-1 block break-words text-xs font-normal text-[var(--theme-warning)] line-clamp-2">
            {caption}
          </span>
        )}
      </h3>
      {!focusMode && turnTools}
    </div>
    {nextTurn && canPreviewPair && (
        <p className="text-xs text-[var(--theme-info)]">
          Pausa entre ambos cortes: {formatTime(nextTurn.start - segment.end)}.
          Puedes preescucharlos o pulsar «Unir sin pausa» para generar un único MP3 en el exportador local.
        </p>
      )}
    {segment.ranges && (
      <p className="text-xs text-[var(--theme-warning)]">
        Intervención compuesta · {formatTime(studioSelectedSeconds(segment.ranges))} de audio útil;
        pausa de {formatTime(segment.ranges[1].start - segment.ranges[0].end)} excluida.
        El proyecto v2 se exporta como un único MP3 con el exportador local actualizado.
        Para ajustar los tiempos, selecciona «Separar cortes».
      </p>
    )}
    {turnActionFeedback?.id === segment.id && (
      <p
        role={turnActionFeedback.error ? 'alert' : 'status'}
        className={turnActionFeedback.error
          ? 'rounded-md border border-[var(--theme-warning)] bg-[var(--theme-panel)] px-3 py-2 text-xs text-[var(--theme-warning)]'
          : 'rounded-md border border-[var(--theme-success)] bg-[var(--theme-panel)] px-3 py-2 text-xs text-[var(--theme-success)]'}>
        {turnActionFeedback.message}
      </p>
    )}
    {compactRows && expandedSegmentId !== segment.id && (
      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-2">
        {profileButtons}
      </div>
    )}
    {(!compactRows || expandedSegmentId === segment.id) && (
    <div className="space-y-2 border-t border-[var(--border)] pt-2">
    {caption && (
      <div className="rounded-lg border border-[var(--theme-warning)] bg-[var(--theme-panel)] p-3">
        <p className="text-xs font-bold text-[var(--theme-warning)]">Transcripción de referencia · solo editor</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--text-secondary)]">{caption}</p>
      </div>
    )}
    {profileButtons}
    {focusMode && boundaryProposal && (
      <section aria-label="Propuesta de ajuste de tiempos" className="space-y-2 rounded-lg border border-[var(--border)] p-3">
        <h4 className="text-sm font-semibold text-[var(--foreground)]">{boundaryProposal.reason === 'overlap' ? 'Propuesta: corregir solapamiento breve' : 'Propuesta: reducir silencio en los bordes'}</h4>
        <p className="text-xs text-[var(--text-secondary)]">Actual: {segment.start.toFixed(3)}–{segment.end.toFixed(3)} s · Propuesto: {boundaryProposal.start.toFixed(3)}–{boundaryProposal.end.toFixed(3)} s</p>
        <p className="text-xs text-[var(--text-secondary)]">Escucha ambos cortes antes de aplicar. La sugerencia no garantiza que se preserve toda la voz.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" data-review-field="preview-proposal" disabled={!canUseBoundaryProposal} onClick={() => previewSegment({ ...segment, id: proposalPreviewId, start: boundaryProposal.start, end: boundaryProposal.end })}
            aria-pressed={previewingId === proposalPreviewId}
            className="theme-action-secondary min-h-11 rounded-lg px-3 py-2 text-xs font-semibold">
            {previewingId === proposalPreviewId ? 'Detener propuesta' : 'Escuchar propuesta'}
          </button>
          <button type="button" disabled={!canUseBoundaryProposal} onClick={applyBoundaryProposal}
            className="theme-action-primary min-h-11 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50">Aplicar ajuste de tiempos</button>
        </div>
      </section>
    )}
    {focusMode && (
      <button type="button" aria-expanded={advancedTurnId === segment.id}
        aria-controls={`studio-advanced-${segment.id}`}
        onClick={() => onToggleAdvanced(segment.id)}
        className="min-h-11 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--theme-link)]">
        {advancedTurnId === segment.id ? 'Ocultar ajustes avanzados' : 'Ajustes avanzados'}
      </button>
    )}
    <div id={`studio-advanced-${segment.id}`} hidden={focusMode && advancedTurnId !== segment.id}
      className={focusMode && advancedTurnId !== segment.id ? 'hidden' : 'space-y-2'}>
      {focusMode && turnTools}
      <label className="block text-sm text-[var(--text-secondary)]">Título
      <input data-review-field="title" value={segment.title} maxLength={200} onChange={event => update(segment.id, {title: event.target.value})}
        className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] p-2 text-[var(--theme-control-text)]"/>
    </label>
    <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3">
      <label className="text-sm text-[var(--text-secondary)]">Inicio (segundos)
        <input data-review-field="start" type="number" min={0} max={duration} step="0.1" value={segment.start}
          disabled={Boolean(segment.ranges)}
          onChange={event => update(segment.id, {start: event.target.valueAsNumber})}
          className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] p-2 text-[var(--theme-control-text)]"/>
      </label>
      <label className="text-sm text-[var(--text-secondary)]">Final (segundos)
        <input data-review-field="end" type="number" min={0} max={duration} step="0.1" value={segment.end}
          disabled={Boolean(segment.ranges)}
          onChange={event => update(segment.id, {end: event.target.valueAsNumber})}
          className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] p-2 text-[var(--theme-control-text)]"/>
      </label>
      <label className="col-span-2 min-w-0 text-sm text-[var(--text-secondary)] sm:col-span-1">Límite de respuesta (segundos)
        <input data-review-field="response" type="number" min={0} max={ROLEPLAY_RESPONSE_MAX_DURATION_SEC} step={1} value={segment.responseLimit}
          onChange={event => update(segment.id, {responseLimit: event.target.valueAsNumber})}
          className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] p-2 text-[var(--theme-control-text)]"/>
      </label>
    </div>
    <button type="button" className="min-h-11 text-left text-sm font-medium text-[var(--theme-link)] hover:underline"
      onClick={() => update(segment.id, {
        title: makeNeutralSegmentTitle(segment.speakerRole, segment.language, index),
      })}>
      Aplicar perfil e idioma al título
    </button>
    <label className="block text-sm text-[var(--text-secondary)]">Instrucciones para el participante
      <textarea data-review-field="instructions" value={segment.scriptPrompt} maxLength={5000} rows={2}
        onChange={event => update(segment.id, {scriptPrompt: event.target.value})}
        className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] p-2 text-[var(--theme-control-text)]"/>
    </label>
    <button type="button" onClick={() => insertProtocol(segment)}
      className="min-h-11 rounded-lg border border-[var(--theme-control-border)] bg-[var(--theme-panel)] px-3 py-2 text-sm text-[var(--theme-info)] hover:bg-[var(--theme-hover)]">
      Añadir protocolo seleccionado a esta intervención
    </button>
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <button type="button" className="min-h-11 rounded-lg border border-[var(--theme-control-border)] px-3 py-2 text-[var(--theme-link)] hover:bg-[var(--theme-hover)]"
        disabled={Boolean(segment.ranges)}
        onClick={() => markAtPlayhead(segment.id, 'start')}>Marcar inicio actual</button>
      <button type="button" className="min-h-11 rounded-lg border border-[var(--theme-control-border)] px-3 py-2 text-[var(--theme-link)] hover:bg-[var(--theme-hover)]"
        disabled={Boolean(segment.ranges)}
        onClick={() => markAtPlayhead(segment.id, 'end')}>Marcar fin actual</button>
      {!compactRows && !focusMode && (
        <button type="button" className="min-h-11 rounded-lg border border-[var(--theme-control-border)] px-3 py-2 text-[var(--theme-success)] hover:bg-[var(--theme-hover)]"
          aria-label={segment.ranges
            ? `${pairPreviewId === segment.id ? 'Detener unión' : 'Escuchar unido'} de intervención ${index + 1}`
            : `${previewingId === segment.id ? 'Detener fragmento' : 'Escuchar fragmento'} de intervención ${index + 1}`}
          onClick={() => previewSegment(segment)}>
          {segment.ranges
            ? pairPreviewId === segment.id ? 'Detener unión' : 'Escuchar unido'
            : previewingId === segment.id ? 'Detener fragmento' : `Escuchar fragmento (${formatTime(segment.start)}–${formatTime(segment.end)})`}
        </button>
      )}
    </div>
    </div>
    </div>
    )}
  </article>
  );
}

// Compare all props, including callbacks; never ignore changes to action identity.
export default memo(StudioInterventionCard);
