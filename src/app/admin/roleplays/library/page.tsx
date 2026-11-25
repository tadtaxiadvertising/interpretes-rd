import Link from 'next/link';
import { AlertTriangle, AudioLines, Copy, Layers3, Library, Plus } from 'lucide-react';
import prisma from '@/lib/prisma';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';
import { getReusableRoleplayAudio, getRoleplaySnapshotHash } from '@/lib/roleplay-library';
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
      orderBy: { createdAt: 'desc' },
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
  searchParams: Promise<{ q?: string; archived?: string }>;
}) {
  const params = await searchParams;
  const q = (params.q ?? '').trim().toLowerCase().slice(0, 100);
  const showArchived = params.archived === '1';
  const result = await getLibrary();
  const matches = result.items.filter((item) =>
    (showArchived ? item.archivedAt !== null : item.archivedAt === null) &&
    (!q || item.titles.some((title) => title.toLowerCase().includes(q)) || item.fingerprint.startsWith(q))
  );
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

      <form action="/admin/roleplays/library" method="get" className="flex flex-wrap gap-3">
        <label className="sr-only" htmlFor="library-query">Buscar ejercicios por título o huella</label>
        <input id="library-query" name="q" type="search" maxLength={100}
          defaultValue={params.q?.slice(0, 100) ?? ''}
          placeholder="Buscar por escenario o identificador SHA-256"
          className="min-w-0 w-full sm:w-auto sm:min-w-0 flex-1 rounded-xl border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] px-4 py-3 text-[var(--theme-control-text)] placeholder:text-[var(--text-tertiary)]" />
        {showArchived && <input type="hidden" name="archived" value="1" />}
        <button type="submit" className="rounded-xl theme-action-primary px-5 py-3 font-semibold">Buscar</button>
        {q && <Link href={showArchived ? '/admin/roleplays/library?archived=1' : '/admin/roleplays/library'} className="rounded-xl border border-[var(--border)] px-4 py-3 text-sm text-[var(--text-secondary)] hover:bg-[var(--theme-hover)]">Limpiar</Link>}
      </form>

      <section aria-label="Ejercicios reutilizables" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">{showArchived ? 'Ejercicios archivados' : 'Ejercicios disponibles'}</h2>
            <div className="mt-2 flex flex-wrap gap-3 text-sm">
              <Link href="/admin/roleplays/library" className={!showArchived ? 'font-bold text-[var(--theme-link)]' : 'text-[var(--text-secondary)] hover:text-[var(--foreground)]'}>Disponibles</Link>
              <Link href="/admin/roleplays/library?archived=1" className={showArchived ? 'font-bold text-[var(--theme-link)]' : 'text-[var(--text-secondary)] hover:text-[var(--foreground)]'}>Eliminados de la biblioteca ({archivedCount})</Link>
            </div>
          </div>
          {!result.error && <p className="text-sm text-[var(--text-secondary)]">{matches.length} instantáneas · {result.scanned} sesiones examinadas</p>}
        </div>
        {!result.error && matches.length === 0 && (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--theme-surface-muted)] p-12 text-center">
            <AudioLines size={38} className="mx-auto mb-3 text-[var(--text-tertiary)]" />
            <p className="font-semibold text-[var(--foreground)]">{showArchived ? 'No hay ejercicios archivados' : q ? 'No hay ejercicios con esa búsqueda' : 'No hay ejercicios reutilizables todavía'}</p>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">{showArchived ? 'Los ejercicios borrados de la biblioteca pueden restaurarse aquí.' : 'Publica un roleplay con audios válidos para incorporarlo a esta biblioteca.'}</p>
          </div>
        )}
        {matches.map((item) => (
          <article key={item.fingerprint} className="rounded-2xl border border-[var(--border)] bg-[var(--theme-panel)] p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h3 className="break-words text-lg font-bold text-[var(--foreground)]">{item.titles[0] || 'Roleplay sin título'}</h3>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                  {item.audioCount} {item.audioCount === 1 ? 'escenario' : 'escenarios'} ·
                  {' '}{item.assignmentsInWindow} {item.assignmentsInWindow === 1 ? 'sesión coincidente' : 'sesiones coincidentes'} en la muestra
                </p>
                <p className="mt-2 text-xs font-medium text-[var(--text-secondary)]">{item.audioKind === 'private' ? 'Audio privado · Apertura bilingüe obligatoria' : 'Audio histórico público · Sin apertura obligatoria'}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {item.titles.slice(0, 5).map((title, index) => (
                    <span key={index} className="rounded-full border border-[var(--border)] bg-[var(--theme-surface-muted)] px-3 py-1 text-xs text-[var(--text-secondary)]">
                      {index + 1}. {title}
                    </span>
                  ))}
                  {item.titles.length > 5 && <span className="px-2 py-1 text-xs text-[var(--text-tertiary)]">+{item.titles.length - 5} más</span>}
                </div>
                <p className="mt-3 flex min-w-0 flex-wrap items-center gap-2 break-all font-mono text-xs text-[var(--text-tertiary)]">
                  <Copy size={13} /> Huella de plantilla: {item.fingerprint.slice(0, 16)}…
                </p>
              </div>
              <div className="flex flex-wrap items-start gap-2">
                {!showArchived && (
                  <>
                    <Link
                      href={`/admin/roleplays/library/${encodeURIComponent(item.sourceSessionId)}`}
                      className="rounded-xl border border-[var(--border)] bg-[var(--theme-surface-muted)] px-4 py-3 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--theme-hover)]"
                    >
                      Escuchar y revisar
                    </Link>
                    <Link
                      href={`/admin/roleplays/new?sourceSessionId=${encodeURIComponent(item.sourceSessionId)}`}
                      className="rounded-xl theme-action-primary px-4 py-3 text-sm font-semibold"
                    >
                      Reutilizar y asignar
                    </Link>
                  </>
                )}
                <RoleplayLibraryVisibilityButton fingerprint={item.fingerprint}
                  sourceSessionId={item.sourceSessionId} archived={showArchived} />
              </div>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
