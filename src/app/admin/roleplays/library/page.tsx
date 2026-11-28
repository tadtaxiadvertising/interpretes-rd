import Link from 'next/link';
import { AlertTriangle, AudioLines, Copy, Layers3, Library, Plus } from 'lucide-react';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';
import { openingAssignmentConfigured } from '@/lib/roleplay/direct-upload-pilot-config';
import { getReusableRoleplayAudio, getRoleplaySnapshotHash } from '@/lib/roleplay-library';
import { ROLEPLAY_TOPICS, resolveRoleplayTopics, matchesRoleplayTopic, parseRoleplayTopicFilters, parseEditorialRoleplayTopic, parseRoleplayLibrarySearch, scoreRoleplayLibrarySearch, ROLEPLAY_LIBRARY_SIZE_OPTIONS, parseRoleplayLibrarySize, matchesRoleplayLibrarySize, selectRoleplayLibraryPreview, paginateRoleplayLibrary } from '@/lib/roleplay-library-topics';
import RoleplayTopicsReadiness from './RoleplayTopicsReadiness';
import { RoleplayLibraryTopicEditor } from './RoleplayLibraryTopicEditor';
import { RoleplayLibraryVisibilityButton } from './RoleplayLibraryVisibilityButton';

export const dynamic = 'force-dynamic';

const SCAN_LIMIT = 400;

async function getLibrary() {
  const storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!storageUrl) {
    return { items: [], scanned: 0, error: 'El almacenamiento de audio no está configurado.' };
  }

  try {
    const sessions = await prisma.roleplaySession.findMany({
      where: { status: { notIn: ['DRAFT', 'CANCELLED'] }, scenarios: { some: {} } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: SCAN_LIMIT,
      select: {
        id: true,
        status: true,
        createdAt: true,
        scenarios: {
          orderBy: { order: 'asc' },
          select: {
            id: true, order: true, title: true, baseAudioUrl: true,
            durationLimitSec: true, scriptPrompt: true, studioTurn: true, studioSpeaker: true, studioLanguage: true, sourceStartSec: true, sourceEndSec: true, expectedKeys: true,
          },
        },
      },
    });

    const versions = new Map<string, {
      sourceSessionId: string;
      fingerprint: string;
      createdAt: Date;
      titles: string[];
      audioCount: number;
      assignmentsInWindow: number;
      archivedAt: Date | null;
      audioKind: 'private' | 'legacy';
    }>();

    for (const session of sessions) {
      const scenarios = session.scenarios;
      const reusable = getReusableRoleplayAudio(scenarios, storageUrl);
      if (!reusable) continue;

      const fingerprint = getRoleplaySnapshotHash(scenarios);
      const existing = versions.get(fingerprint);
      if (existing) {
        existing.assignmentsInWindow++;
        continue;
      }
      versions.set(fingerprint, {
        sourceSessionId: session.id,
        fingerprint,
        createdAt: session.createdAt,
        titles: scenarios.map((scenario) => scenario.title),
        audioCount: scenarios.length,
        assignmentsInWindow: 1,
        archivedAt: null,
        audioKind: reusable.kind,
      });
    }
    const items = [...versions.values()];
    if (items.length > 0) {
      const archives = await prisma.roleplayLibraryArchive.findMany({
        where: { fingerprint: { in: items.map((item) => item.fingerprint) } },
        select: { fingerprint: true, archivedAt: true },
      });
      const archivedAtByFingerprint = new Map(archives.map((entry) => [entry.fingerprint, entry.archivedAt]));
      for (const item of items) item.archivedAt = archivedAtByFingerprint.get(item.fingerprint) ?? null;
    }
    return { items, scanned: sessions.length, error: null as string | null };
  } catch (error) {
    console.error('[ADMIN ROLEPLAY LIBRARY] Failed to load existing scenario snapshots:', safeServerErrorCategory(error));
    return {
      items: [],
      scanned: 0,
      error: 'No se pudo consultar la biblioteca de roleplays. Revisa el estado de la base de datos.',
    };
  }
}

export default async function RoleplayLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; archived?: string | string[]; topic?: string | string[]; subtopic?: string | string[]; size?: string | string[]; page?: string | string[] }>;
}) {
  const params = await searchParams;
  const q = parseRoleplayLibrarySearch(params.q);
  const showArchived = params.archived === '1';
  const size = parseRoleplayLibrarySize(params.size);
  const privateAssignmentConfigured = openingAssignmentConfigured(process.env);
  const result = await getLibrary();
  let editorialEnabled = process.env.ROLEPLAY_LIBRARY_EDITORIAL_TOPICS_ENABLED === 'true';
  let editorialUnavailable = false;
  const editorial = new Map<string, { topic: string; subtopic: string }>();
  if (editorialEnabled && result.items.length) {
    try {
      const rows = await prisma.$queryRaw<Array<{ fingerprint: string; topic: string; subtopic: string }>>`
        SELECT fingerprint, topic, subtopic FROM public.roleplay_library_topics
        WHERE fingerprint IN (${Prisma.join(result.items.map(item => item.fingerprint))})`;
      for (const row of rows) {
        const valid = parseEditorialRoleplayTopic(row.topic, row.subtopic);
        if (valid) editorial.set(row.fingerprint, valid);
      }
    } catch (error) {
      console.error('[ADMIN ROLEPLAY LIBRARY] Failed to read editorial topics:', safeServerErrorCategory(error));
      editorialEnabled = false;
      editorialUnavailable = true;
    }
  }
  const { topic, subtopic } = parseRoleplayTopicFilters(params.topic, params.subtopic);
  const searchable = result.items.filter(item =>
    (showArchived ? item.archivedAt !== null : item.archivedAt === null) && matchesRoleplayLibrarySize(item.audioCount, size)
  ).map(item => ({ ...item, editorialTopic: editorial.get(item.fingerprint) ?? null, topicHints: resolveRoleplayTopics(item.titles, editorial.get(item.fingerprint)) }))
    .map(item => ({ ...item, searchScore: scoreRoleplayLibrarySearch(item.titles, item.fingerprint, item.topicHints, q) }))
    .filter(item => item.searchScore > 0)
    .sort((a, b) => b.searchScore - a.searchScore);
  const matches = searchable.filter(item => matchesRoleplayTopic(item.topicHints, topic, subtopic));
  const pagination = paginateRoleplayLibrary(matches, params.page);
  const selectedTopic = ROLEPLAY_TOPICS.find(item => item.id === topic);
  const topicCount = (id: string, child = '') => searchable.filter(item => matchesRoleplayTopic(item.topicHints, id, child)).length;
  const libraryHref = (nextTopic = '', nextSubtopic = '', nextQ = q, archived = showArchived, nextSize = size, nextPage = 1) => {
    const query = new URLSearchParams();
    if (nextQ) query.set('q', nextQ);
    if (nextSize) query.set('size', nextSize);
    if (nextPage > 1) query.set('page', String(nextPage));
    if (archived) query.set('archived', '1');
    if (nextTopic) query.set('topic', nextTopic);
    if (nextSubtopic) query.set('subtopic', nextSubtopic);
    const suffix = query.toString();
    return '/admin/roleplays/library' + (suffix ? '?' + suffix : '');
  };
  const archivedCount = result.items.filter((item) => item.archivedAt !== null).length;

  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--theme-link)]">
            <Library size={17} /> Roleplay / Biblioteca
          </div>
          <h1 className="text-3xl font-bold text-[var(--foreground)]">Biblioteca de roleplays</h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--text-secondary)]">
            Reutiliza los escenarios y audios de sesiones publicadas. Una misma grabación no necesita volver a subirse
            para asignar una nueva práctica.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/roleplays" className="rounded-xl border border-[var(--border)] bg-[var(--theme-surface-muted)] px-4 py-3 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--theme-hover)]">
            Sesiones
          </Link>
          <Link href="/admin/roleplays/new" className="inline-flex items-center gap-2 rounded-xl theme-action-primary px-4 py-3 text-sm font-semibold">
            <Plus size={17} /> Importar roleplay
          </Link>
        </div>
      </header>

      <section className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-5 text-sm text-[var(--theme-link)]">
        <div className="mb-2 flex items-center gap-2 font-semibold"><Layers3 size={17} /> Plantillas reutilizables</div>
        <p className="text-[var(--theme-link)]">
          Esta primera biblioteca recupera los ejercicios ya publicados y agrupa configuraciones equivalentes por una huella SHA-256
          de referencias y metadatos. No modifica ni elimina sesiones históricas, y no requiere una nueva tabla. La edición y el
          versionado editorial formal se incorporarán en una etapa posterior.
        </p>
        <p className="mt-2 text-xs text-[var(--text-secondary)]">
          Se examinan las últimas {SCAN_LIMIT} sesiones con escenarios; los ejercicios con audio externo,
          rutas firmadas temporales o archivos sin referencia segura no se ofrecen para reutilización.
        </p>
      </section>

      {result.error && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-[var(--theme-danger)]">
          <AlertTriangle size={19} className="shrink-0" />
          <p>{result.error}</p>
        </div>
      )}

      {editorialUnavailable && <p role="status" className="rounded-lg border border-[var(--border)] p-3 text-sm text-[var(--theme-warning)]">La clasificación guardada no está disponible. Se muestran las sugerencias de títulos; no se han cambiado las categorías.</p>}

      <RoleplayTopicsReadiness />

      <form action="/admin/roleplays/library" method="get" className="flex flex-wrap gap-3">
        <label className="sr-only" htmlFor="library-query">Buscar ejercicios por título, tema o huella</label>
        <input id="library-query" name="q" type="search" maxLength={100}
          defaultValue={q}
          placeholder="Buscar escenario, tema o palabras en español / inglés"
          className="min-w-0 w-full sm:w-auto sm:min-w-0 flex-1 rounded-xl border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] px-4 py-3 text-[var(--theme-control-text)] placeholder:text-[var(--text-tertiary)]" />
        {showArchived && <input type="hidden" name="archived" value="1" />}
        {topic && <input type="hidden" name="topic" value={topic} />}
        {subtopic && <input type="hidden" name="subtopic" value={subtopic} />}
        <div className="w-full sm:w-auto">
          <label htmlFor="library-size" className="mb-1 block text-xs font-semibold text-[var(--text-secondary)]">Cantidad de escenarios</label>
          <select id="library-size" name="size" defaultValue={size} className="min-h-11 w-full rounded-xl border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] px-3 py-2 text-sm text-[var(--theme-control-text)]">
            {ROLEPLAY_LIBRARY_SIZE_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </div>
        <button type="submit" className="min-h-11 self-end rounded-xl theme-action-primary px-5 py-3 font-semibold">Buscar</button>
        {(q || topic || size) && <Link href={libraryHref('', '', '', showArchived, '')} className="rounded-xl border border-[var(--border)] px-4 py-3 text-sm text-[var(--text-secondary)] hover:bg-[var(--theme-hover)]">Limpiar</Link>}
      </form>

      {!result.error && (
        <nav aria-label="Temas y subtemas de roleplays" className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--theme-panel)] p-4">
          <div>
            <h2 className="font-semibold text-[var(--foreground)]">Explorar por tema</h2>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">{editorialEnabled ? 'Las categorías guardadas prevalecen sobre las sugerencias de los títulos. Los ejercicios sin categoría pueden aparecer en varios temas.' : 'Sugerencias a partir de los títulos existentes; un ejercicio puede aparecer en varios temas.'}</p>
          </div>
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            {[{ id: '', label: 'Todos' }, ...ROLEPLAY_TOPICS, { id: 'unclassified', label: 'Sin clasificar' }].map(item => (
              <Link key={item.id || 'all'} href={libraryHref(item.id)}
                aria-current={topic === item.id ? 'true' : undefined}
                className={`flex min-h-11 min-w-0 flex-wrap items-center justify-between gap-1 rounded-xl border px-3 py-2 text-sm ${topic === item.id ? 'theme-action-primary' : 'theme-action-secondary border-[var(--border)]'}`}>
                <span className="break-words">{item.label}</span>
                <span className="text-xs tabular-nums">{topicCount(item.id)}</span>
              </Link>
            ))}
          </div>
          {selectedTopic && (
            <div className="space-y-2 border-t border-[var(--border)] pt-3">
              <h3 className="text-sm font-semibold text-[var(--foreground)]">{selectedTopic.label} · Subtemas</h3>
              <div className="flex flex-wrap gap-2">
                {[{ id: '', label: 'Todos los subtemas' }, ...selectedTopic.subtopics].map(item => (
                  <Link key={item.id || 'all'} href={libraryHref(topic, item.id)}
                    aria-current={subtopic === item.id ? 'true' : undefined}
                    className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm ${subtopic === item.id ? 'theme-action-primary' : 'theme-action-secondary'}`}>
                    {item.label} <span className="text-xs tabular-nums">{topicCount(topic, item.id)}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </nav>
      )}

      <section aria-label="Ejercicios reutilizables" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">{showArchived ? 'Ejercicios archivados' : 'Ejercicios disponibles'}</h2>
            <div className="mt-2 flex flex-wrap gap-3 text-sm">
              <Link href={libraryHref(topic, subtopic, q, false)} className={!showArchived ? 'font-bold text-[var(--theme-link)]' : 'text-[var(--text-secondary)] hover:text-[var(--foreground)]'}>Disponibles</Link>
              <Link href={libraryHref(topic, subtopic, q, true)} className={showArchived ? 'font-bold text-[var(--theme-link)]' : 'text-[var(--text-secondary)] hover:text-[var(--foreground)]'}>Eliminados de la biblioteca ({archivedCount})</Link>
            </div>
          </div>
          {!result.error && <p className="text-sm text-[var(--text-secondary)]">{matches.length ? `Mostrando ${pagination.first}–${pagination.last} de ${matches.length} plantillas` : '0 plantillas'} · {result.scanned} sesiones examinadas</p>}
        </div>
        {!result.error && matches.length === 0 && (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--theme-surface-muted)] p-12 text-center">
            <AudioLines size={38} className="mx-auto mb-3 text-[var(--text-tertiary)]" />
            <p className="font-semibold text-[var(--foreground)]">{q || topic || size ? 'No hay ejercicios con estos filtros' : showArchived ? 'No hay ejercicios archivados' : 'No hay ejercicios reutilizables todavía'}</p>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">{q || topic || size ? 'Cambia de tema, subtema, cantidad de escenarios o búsqueda para ver otros ejercicios.' : showArchived ? 'Los ejercicios borrados de la biblioteca pueden restaurarse aquí.' : 'Publica un roleplay con audios válidos para incorporarlo a esta biblioteca.'}</p>
          </div>
        )}
        {pagination.visible.map((item) => (
          <article key={item.fingerprint} className="rounded-2xl border border-[var(--border)] bg-[var(--theme-panel)] p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h3 className="break-words text-lg font-bold text-[var(--foreground)]">{item.titles[0] || 'Roleplay sin título'}</h3>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                  {item.audioCount} {item.audioCount === 1 ? 'escenario' : 'escenarios'} ·
                  {' '}{item.assignmentsInWindow} {item.assignmentsInWindow === 1 ? 'sesión coincidente' : 'sesiones coincidentes'} en la muestra
                </p>
                <p className="mt-2 text-xs text-[var(--text-secondary)]">{item.editorialTopic ? 'Tema guardado:' : 'Temas sugeridos:'} {item.topicHints.length
                  ? item.topicHints.map(hint => {
                    const parent = ROLEPLAY_TOPICS.find(entry => entry.id === hint.topic);
                    const child = parent?.subtopics.find(entry => entry.id === hint.subtopic);
                    return parent && child ? parent.label + ' / ' + child.label : '';
                  }).filter(Boolean).join(' · ')
                  : 'Sin clasificar'}</p>
                <p className="mt-2 text-xs font-medium text-[var(--text-secondary)]">{item.audioKind === 'private' ? 'Audio privado · Apertura bilingüe obligatoria' : 'Audio histórico público · Sin apertura obligatoria'}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectRoleplayLibraryPreview(item.titles, q).map(({ title, index, matches }) => (
                    <span key={index} className={`max-w-full break-words rounded-full border px-3 py-1 text-xs ${matches ? 'border-[var(--theme-control-border)] font-semibold text-[var(--theme-link)]' : 'border-[var(--border)] bg-[var(--theme-surface-muted)] text-[var(--text-secondary)]'}`}>
                      {index + 1}. {title}{matches && <span className="sr-only"> (coincidencia de búsqueda)</span>}
                    </span>
                  ))}
                  
                </div>
                {item.titles.length > 5 && <details className="mt-2 text-xs text-[var(--text-secondary)]">
                  <summary className="min-h-11 cursor-pointer py-3 font-semibold text-[var(--theme-link)]">Ver los {item.titles.length} escenarios</summary>
                  <ol className="list-decimal space-y-1 pl-5">
                    {item.titles.map((title, index) => <li key={index} className="break-words">{title}</li>)}
                  </ol>
                </details>}
                <p className="mt-3 flex min-w-0 flex-wrap items-center gap-2 break-all font-mono text-xs text-[var(--text-tertiary)]">
                  <Copy size={13} /> Huella de plantilla: {item.fingerprint.slice(0, 16)}…
                </p>
              </div>
              <div className="flex flex-wrap items-start gap-2">
                {!showArchived && (
                  <>
                    <Link
                      href={`/admin/roleplays/library/${encodeURIComponent(item.sourceSessionId)}`}
                      prefetch={false}
                      className="rounded-xl border border-[var(--border)] bg-[var(--theme-surface-muted)] px-4 py-3 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--theme-hover)]"
                    >
                      Escuchar y revisar
                    </Link>
                    {item.audioKind === 'private' && !privateAssignmentConfigured ? (
                      <p className="max-w-xs rounded-xl border border-[var(--theme-control-border)] p-3 text-xs text-[var(--theme-warning)]">Asignación privada no habilitada. Puedes revisar la plantilla sin volver a subir audio.</p>
                    ) : (
                      <Link
                        href={`/admin/roleplays/new?sourceSessionId=${encodeURIComponent(item.sourceSessionId)}`}
                        prefetch={false}
                        className="rounded-xl theme-action-primary px-4 py-3 text-sm font-semibold"
                      >
                        Reutilizar y asignar
                      </Link>
                    )}
                  </>
                )}
                {editorialEnabled && <RoleplayLibraryTopicEditor key={item.fingerprint + ':' + (item.editorialTopic?.topic ?? '') + ':' + (item.editorialTopic?.subtopic ?? '')}
                  fingerprint={item.fingerprint} sourceSessionId={item.sourceSessionId} selection={item.editorialTopic} />}
                <RoleplayLibraryVisibilityButton fingerprint={item.fingerprint}
                  sourceSessionId={item.sourceSessionId} archived={showArchived} />
              </div>
            </div>
          </article>
        ))}
        {!result.error && pagination.totalPages > 1 && (
          <nav aria-label="Páginas de plantillas" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] p-3 text-sm">
            {pagination.page > 1 ? (
              <Link href={libraryHref(topic, subtopic, q, showArchived, size, pagination.page - 1)} prefetch={false} className="theme-action-secondary inline-flex min-h-11 items-center rounded-lg px-4 py-2 font-semibold">Anterior</Link>
            ) : <span className="px-4 py-2 text-[var(--text-secondary)]">Inicio</span>}
            <p aria-current="page" className="text-[var(--foreground)]">Página {pagination.page} de {pagination.totalPages}</p>
            {pagination.page < pagination.totalPages ? (
              <Link href={libraryHref(topic, subtopic, q, showArchived, size, pagination.page + 1)} prefetch={false} className="theme-action-secondary inline-flex min-h-11 items-center rounded-lg px-4 py-2 font-semibold">Siguiente</Link>
            ) : <span className="px-4 py-2 text-[var(--text-secondary)]">Fin</span>}
          </nav>
        )}
      </section>
    </div>
  );
}
