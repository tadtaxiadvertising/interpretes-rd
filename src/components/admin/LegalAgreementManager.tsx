'use client';

import { useState } from 'react';
import { getLegalAgreementAdminData, publishLegalAgreementDraft, saveLegalAgreementDraft } from '@/app/actions/legal-agreements';

type Agreement = { id: string; version: string; title: string; content: string; contentHash?: string; publishedAt?: Date | null; updatedAt?: Date };
type Data = { published: Agreement | null; drafts: Agreement[]; acceptances: number };

export default function LegalAgreementManager({ initialData, initialError }: { initialData: Data | null; initialError?: string }) {
  const [data, setData] = useState<Data | null>(initialData);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [version, setVersion] = useState('');
  const [title, setTitle] = useState('Contrato de Prestación de Servicios Profesionales');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(initialError || '');

  function editDraft(draft: Agreement) {
    setEditingId(draft.id);
    setVersion(draft.version);
    setTitle(draft.title);
    setContent(draft.content);
    setMessage('');
  }

  function newDraft() {
    setEditingId(undefined);
    setVersion('');
    setTitle('Contrato de Prestación de Servicios Profesionales');
    setContent(data?.published?.content || '');
    setMessage('');
  }

  async function refresh() {
    const result = await getLegalAgreementAdminData();
    if (result.success) setData(result.data);
    else setMessage(result.error);
  }

  async function save() {
    setBusy(true);
    setMessage('');
    try {
      const result = await saveLegalAgreementDraft({ id: editingId, version, title, content });
      if (!result.success) { setMessage(result.error); return; }
      setMessage('Borrador guardado. El acuerdo publicado no se ha modificado.');
      await refresh();
    } catch {
      setMessage('No se pudo guardar el borrador. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  async function publish(id: string) {
    if (!window.confirm('Publicar esta versión? Las nuevas aceptaciones deberán quedar asociadas a este texto.')) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await publishLegalAgreementDraft(id);
      if (!result.success) { setMessage(result.error); return; }
      setMessage('Nueva versión publicada. Las versiones anteriores y sus aceptaciones se conservan.');
      setEditingId(undefined);
      await refresh();
    } catch {
      setMessage('No se pudo publicar el acuerdo. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6 text-slate-100">
      <header>
        <p className="text-sm font-semibold uppercase tracking-widest text-blue-400">Administración</p>
        <h1 className="mt-2 text-3xl font-bold">Acuerdos legales</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">Edita borradores y publica nuevas versiones. Una versión publicada es inmutable y cada aceptación conserva la versión y el hash del texto aceptado.</p>
      </header>

      {message && <div role="status" className="rounded-xl border border-blue-400/20 bg-blue-500/10 p-4 text-sm text-blue-100">{message}</div>}

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-slate-900 p-5 md:col-span-2">
          <h2 className="text-lg font-semibold">Versión publicada vigente</h2>
          {data?.published ? <>
            <p className="mt-3 font-medium">{data.published.title} · v{data.published.version}</p>
            <p className="mt-1 break-all text-xs text-slate-500">SHA-256: {data.published.contentHash || 'No disponible'}</p>
            <p className="mt-1 text-xs text-slate-400">Publicada: {data.published.publishedAt ? new Date(data.published.publishedAt).toLocaleString() : '—'}</p>
          </> : <p className="mt-3 text-sm text-amber-300">No se encontró una versión publicada.</p>}
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-900 p-5">
          <h2 className="text-lg font-semibold">Aceptaciones registradas</h2>
          <p className="mt-3 text-3xl font-bold">{data?.acceptances ?? '—'}</p>
          <p className="mt-1 text-xs text-slate-400">Registros históricos, todas las versiones</p>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4 rounded-2xl border border-white/10 bg-slate-900 p-5">
          <h2 className="text-lg font-semibold">{editingId ? 'Editar borrador' : 'Crear borrador'}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm text-slate-300">Versión
              <input value={version} onChange={e => setVersion(e.target.value)} placeholder="2026-11-01" className="mt-2 w-full rounded-xl border border-white/15 bg-slate-950 px-3 py-2 text-white outline-none focus:border-blue-500" />
            </label>
            <label className="block text-sm text-slate-300">Título
              <input value={title} onChange={e => setTitle(e.target.value)} className="mt-2 w-full rounded-xl border border-white/15 bg-slate-950 px-3 py-2 text-white outline-none focus:border-blue-500" />
            </label>
          </div>
          <label className="block text-sm text-slate-300">Contenido del acuerdo (Markdown sencillo)
            <textarea value={content} onChange={e => setContent(e.target.value)} rows={18} spellCheck className="mt-2 w-full resize-y rounded-xl border border-white/15 bg-slate-950 px-3 py-3 font-mono text-sm leading-6 text-slate-100 outline-none focus:border-blue-500" placeholder="Escribe el contenido completo del acuerdo…" />
          </label>
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={busy} onClick={save} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">{busy ? 'Procesando…' : 'Guardar borrador'}</button>
            <button type="button" disabled={busy} onClick={newDraft} className="rounded-xl border border-white/15 px-5 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/5 disabled:opacity-50">Nuevo borrador</button>
          </div>
        </div>

        <aside className="space-y-4 rounded-2xl border border-white/10 bg-slate-900 p-5">
          <h2 className="text-lg font-semibold">Borradores</h2>
          {!data?.drafts.length && <p className="text-sm text-slate-400">No hay borradores pendientes.</p>}
          {data?.drafts.map(draft => <div key={draft.id} className="space-y-2 rounded-xl border border-white/10 p-3">
            <p className="font-medium">{draft.title}</p>
            <p className="text-xs text-slate-400">Versión {draft.version}</p>
            <button type="button" onClick={() => editDraft(draft)} className="w-full rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/5">Editar borrador</button>
            <button type="button" disabled={busy} onClick={() => publish(draft.id)} className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">Publicar versión</button>
          </div>)}
          <p className="pt-2 text-xs leading-5 text-slate-500">Antes de publicar, confirma la revisión legal del contenido. Publicar una versión no elimina ni modifica las versiones o aceptaciones anteriores.</p>
        </aside>
      </section>
    </main>
  );
}
