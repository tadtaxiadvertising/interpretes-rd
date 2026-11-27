'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { formatStudioTime as formatTime } from '@/lib/roleplay-studio/format-time';
import { filterHappyScribeLibrary, happyScribeResultPage, happyScribeReady, type HappyScribeLibraryItem } from '@/lib/roleplay-studio/happyscribe-library';

type Props = {
  items: HappyScribeLibraryItem[];
  selectedId: string;
  loading: boolean;
  importing: boolean;
  mediaImporting: boolean;
  mediaEnabled: boolean;
  hasMore: boolean;
  configUnavailable: boolean;
  onRefresh: () => void;
  onLoadMore: () => void;
  onRenew: () => void;
  onSelect: (id: string) => void;
  onImportAudio: () => void;
  onImportTranscript: () => void;
  onCancelAudio: () => void;
  onCancelTranscript: () => void;
};

/** Local search state stays inside the panel. The Studio owns network requests,
 * editorial preflight, cancellation, and source replacement. */
export default function HappyScribeLibraryPanel({
  items: happyScribeItems, selectedId: happyScribeSelectedId,
  loading: happyScribeLoading, importing: happyScribeImporting,
  mediaImporting: happyScribeMediaImporting, mediaEnabled: happyScribeMediaEnabled,
  hasMore: happyScribeHasMore, configUnavailable: happyScribeConfigUnavailable,
  onRefresh, onLoadMore, onRenew, onSelect, onImportAudio, onImportTranscript,
  onCancelAudio, onCancelTranscript,
}: Props) {
  const [happyScribeQuery, setHappyScribeQuery] = useState('');
  const [happyScribeReadyOnly, setHappyScribeReadyOnly] = useState(false);
  const [happyScribeLanguage, setHappyScribeLanguage] = useState('');
  const [happyScribeFolder, setHappyScribeFolder] = useState('');
  const [happyScribeResultIndex, setHappyScribeResultIndex] = useState(0);
  const happyScribeSelection = happyScribeItems.find(item => item.id === happyScribeSelectedId);
  const happyScribeFiltered = useMemo(() => filterHappyScribeLibrary(happyScribeItems, {
    query: happyScribeQuery, readyOnly: happyScribeReadyOnly, language: happyScribeLanguage, folder: happyScribeFolder,
  }), [happyScribeItems, happyScribeQuery, happyScribeReadyOnly, happyScribeLanguage, happyScribeFolder]);
  const happyScribeResults = happyScribeResultPage(happyScribeFiltered, happyScribeResultIndex, happyScribeSelection);
  const happyScribeLanguages = useMemo(() => [...new Set(happyScribeItems.flatMap(item => item.language ? [item.language] : []))].sort(), [happyScribeItems]);
  const happyScribeFolders = useMemo(() => [...new Set(happyScribeItems.flatMap(item => item.folder ? [item.folder] : []))].sort(), [happyScribeItems]);
  const resetHappyScribeFilters = () => {
    setHappyScribeQuery(''); setHappyScribeReadyOnly(false); setHappyScribeLanguage(''); setHappyScribeFolder(''); setHappyScribeResultIndex(0);
  };

  return (
  <div className="mt-4 rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <p className="text-sm font-semibold text-[var(--theme-success)]">Importar desde HappyScribe</p>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          Importa el MP3 original desde HappyScribe o selecciónalo en tu equipo. Después importa los tiempos y textos; revisa las voces antes de excluir al intérprete original.
        </p>
      </div>
      <button type="button" onClick={onRefresh}
        disabled={happyScribeLoading || happyScribeImporting || happyScribeMediaImporting}
        className="rounded-lg border border-emerald-300/30 px-3 py-2 text-sm text-[var(--theme-success)] disabled:opacity-50">
        {happyScribeLoading ? 'Consultando…' : 'Actualizar biblioteca'}
      </button>
    </div>
    {happyScribeConfigUnavailable && (
      <div role="alert" className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-sm text-[var(--theme-warning)]">
        <p>La biblioteca no está disponible por la configuración del servidor. No se ha descargado ningún audio ni transcripción.</p>
        <Link href="/admin/roleplays/settings" className="mt-2 inline-block font-semibold text-[var(--theme-link)] underline hover:text-[var(--theme-link)]">
          Revisar configuración de Audio Studio
        </Link>
        <p className="mt-2 text-xs text-[var(--theme-warning)]">
          Si ya existe una credencial cifrada, recupera la clave original de Easypanel. No la sustituyas por una nueva sin recuperar la anterior.
        </p>
      </div>
    )}
    {happyScribeItems.length > 0 && (
      <section aria-label="Buscar en biblioteca de HappyScribe" className="mt-3 space-y-2">
        <p className="text-xs text-[var(--text-secondary)]">Busca entre las transcripciones cargadas por nombre, carpeta o idioma. Para buscar en otras páginas del espacio, pulsa «Cargar más transcripciones (50)». Los filtros no consultan al proveedor.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="space-y-1 text-xs text-[var(--text-secondary)]">Buscar transcripciones
            <input type="search" value={happyScribeQuery} maxLength={240} onChange={event => { setHappyScribeQuery(event.currentTarget.value); setHappyScribeResultIndex(0); }}
              placeholder="Nombre, carpeta o idioma" className="block w-full rounded-lg border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] p-2 text-sm text-[var(--theme-control-text)]"/>
          </label>
          <label className="space-y-1 text-xs text-[var(--text-secondary)]">Idioma de HappyScribe
            <select value={happyScribeLanguage} onChange={event => { setHappyScribeLanguage(event.currentTarget.value); setHappyScribeResultIndex(0); }}
              className="block w-full rounded-lg border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] p-2 text-sm text-[var(--theme-control-text)]">
              <option value="">Todos los idiomas</option>
              {happyScribeLanguages.map(language => <option key={language}>{language}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs text-[var(--text-secondary)]">Carpeta de HappyScribe
            <select value={happyScribeFolder} onChange={event => { setHappyScribeFolder(event.currentTarget.value); setHappyScribeResultIndex(0); }}
              className="block w-full rounded-lg border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] p-2 text-sm text-[var(--theme-control-text)]">
              <option value="">Todas las carpetas</option>
              {happyScribeFolders.map(folder => <option key={folder}>{folder}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--foreground)]">
            <input type="checkbox" checked={happyScribeReadyOnly} onChange={event => { setHappyScribeReadyOnly(event.currentTarget.checked); setHappyScribeResultIndex(0); }}/>
            Solo transcripciones completadas
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span aria-live="polite">{happyScribeFiltered.length} coincidencias · página de resultados {happyScribeResults.index+1}/{happyScribeResults.pages}</span>
          <button type="button" className="theme-action-secondary rounded px-2 py-1 disabled:opacity-50" disabled={happyScribeResults.index===0} onClick={() => setHappyScribeResultIndex(happyScribeResults.index-1)}>Resultados anteriores</button>
          <button type="button" className="theme-action-secondary rounded px-2 py-1 disabled:opacity-50" disabled={happyScribeResults.index+1>=happyScribeResults.pages} onClick={() => setHappyScribeResultIndex(happyScribeResults.index+1)}>Resultados siguientes</button>
          <button type="button" onClick={resetHappyScribeFilters} className="theme-action-secondary rounded px-2 py-1">Limpiar filtros</button>
        </div>
        {happyScribeFiltered.length===0 && <p className="text-xs text-[var(--text-secondary)]">{happyScribeHasMore ? 'Sin coincidencias en las páginas cargadas. Puedes cargar otra página sin perder los filtros.' : 'Sin coincidencias. Prueba otros filtros.'}</p>}
        {happyScribeResults.pinned && <p className="text-xs text-[var(--theme-warning)]">La selección actual está fuera de estos resultados. Se conserva para evitar cambiar de grabación accidentalmente.</p>}
      </section>
    )}
    {happyScribeItems.length > 0 && (
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <select aria-label="Transcripción de HappyScribe"
          disabled={happyScribeImporting || happyScribeLoading}
          value={happyScribeSelectedId}
          onChange={event => onSelect(event.currentTarget.value)}
          className="min-w-0 flex-1 rounded-lg border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] p-2 text-sm text-[var(--theme-control-text)]">
          <option value="">Selecciona una transcripción</option>
          {happyScribeResults.pinned && <option value={happyScribeResults.pinned.id}>Selección actual: {happyScribeResults.pinned.name}</option>}
          {happyScribeResults.results.map(item => (
            <option key={item.id} value={item.id} disabled={!happyScribeReady(item)}>
              {item.name} · {item.state} · {item.language || 'Idioma desconocido'}
            </option>
          ))}
        </select>
        {happyScribeMediaEnabled && (
          <button type="button" onClick={onImportAudio}
            disabled={!happyScribeSelectedId || happyScribeMediaImporting || happyScribeLoading ||
              happyScribeItems.find(item => item.id === happyScribeSelectedId)?.state !== 'automatic_done'}
            className="rounded-lg border border-emerald-300/30 px-4 py-2 text-sm font-semibold text-[var(--theme-success)] disabled:opacity-50">
            {happyScribeMediaImporting ? 'Descargando audio…' : 'Importar audio original'}
          </button>
        )}
        {happyScribeMediaImporting && (
          <button type="button" onClick={onCancelAudio} className="rounded-lg border border-amber-300/30 px-3 py-2 text-sm text-[var(--theme-warning)]">
            Cancelar descarga
          </button>
        )}
        <button type="button" onClick={onImportTranscript}
          disabled={!happyScribeSelectedId || happyScribeImporting || happyScribeMediaImporting || happyScribeLoading}
          className="rounded-lg theme-action-success px-4 py-2 text-sm font-semibold">
          {happyScribeImporting ? 'Importando…' : 'Importar transcripción'}
        </button>
        {happyScribeImporting && (
          <button type="button" onClick={onCancelTranscript}
            className="rounded-lg border border-amber-300/30 px-3 py-2 text-sm text-[var(--theme-warning)]">
            Cancelar transcripción
          </button>
        )}
      </div>
    )}
    {happyScribeSelection && (
      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] p-2 text-xs text-[var(--text-secondary)]">
        <span className="font-medium text-[var(--foreground)]">{happyScribeSelection.name}</span>
        <span>{happyScribeSelection.folder || 'Sin carpeta'} · {happyScribeSelection.language || 'Idioma desconocido'} · {happyScribeSelection.durationSeconds === null ? 'Duración desconocida' : formatTime(happyScribeSelection.durationSeconds)}</span>
        <button type="button" disabled={happyScribeLoading || happyScribeImporting || happyScribeMediaImporting}
          onClick={onRenew}
          className="theme-action-secondary rounded px-2 py-1 font-semibold disabled:opacity-50">Renovar selección</button>
      </div>
    )}
    {happyScribeItems.length > 0 && (
      <p className="mt-2 text-xs text-[var(--text-secondary)]">
        {happyScribeItems.length} transcripciones cargadas · {happyScribeHasMore ? 'hay más resultados disponibles' : 'no hay más páginas disponibles'} · sin importar ni descargar archivos.
      </p>
    )}
    {happyScribeHasMore && (
      <button type="button" onClick={onLoadMore}
        disabled={happyScribeLoading || happyScribeImporting || happyScribeMediaImporting}
        className="mt-2 rounded-lg border border-emerald-300/30 px-3 py-2 text-sm text-[var(--theme-success)] disabled:opacity-50">
        {happyScribeLoading ? 'Consultando…' : 'Cargar más transcripciones (50)'}
      </button>
    )}
    {happyScribeItems.length === 0 && !happyScribeLoading && (
      <p className="mt-2 text-xs text-[var(--text-tertiary)]">Pulsa «Actualizar biblioteca» para consultar los archivos disponibles en el espacio conectado.</p>
    )}
  </div>

  );
}
