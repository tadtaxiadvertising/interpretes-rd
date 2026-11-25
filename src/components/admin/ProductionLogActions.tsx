'use client';

import { deleteRecord, editRecord } from '@/app/actions/admin-actions';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { Modal } from '@/components/Modal';
import { useForm } from 'react-hook-form';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';

/* ── Types ──────────────────────────────────────────────── */

type LogRow = {
  id: number;
  interpreterId: number | null;
  date: string;
  interpretedMinutes: number;
  callsAttended: number;
  adherence: number;
  status: string;
  observaciones: string | null;
  interpreterName: string;
};

/* ── Client-side Zod schema — only editable fields ── */

const EditFormSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato inválido (YYYY-MM-DD)'),
  interpretedMinutes: z
    .number({ message: 'Número inválido' })
    .int({ message: 'Debe ser entero' })
    .min(0, { message: 'Mínimo 0' })
    .max(1440, { message: 'Máximo 1440' }),
  callsAttended: z
    .number({ message: 'Número inválido' })
    .int({ message: 'Debe ser entero' })
    .min(0, { message: 'Mínimo 0' }),
  adherence: z
    .number({ message: 'Número inválido' })
    .min(0, { message: 'Mínimo 0%' })
    .max(100, { message: 'Máximo 100%' }),
  status: z
    .string()
    .trim()
    .min(1, { message: 'Estado requerido' })
    .max(40, { message: 'Máximo 40 caracteres' }),
  observaciones: z
    .string()
    .max(1000, { message: 'Máximo 1000 caracteres' }),
});

type EditFormData = z.infer<typeof EditFormSchema>;

/* ── Component ──────────────────────────────────────────── */

export function ProductionLogActions({ log }: { log: LogRow }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  /* ── react-hook-form ────────────────────────────────────── */

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EditFormData>({
    resolver: zodResolver(EditFormSchema),
    defaultValues: {
      date: log.date,
      interpretedMinutes: log.interpretedMinutes,
      callsAttended: log.callsAttended,
      adherence: log.adherence,
      status: log.status,
      observaciones: log.observaciones ?? '',
    },
  });

  /* Reset form to fresh prop values whenever the modal opens */

  useEffect(() => {
    if (editOpen) {
      reset({
        date: log.date,
        interpretedMinutes: log.interpretedMinutes,
        callsAttended: log.callsAttended,
        adherence: log.adherence,
        status: log.status,
        observaciones: log.observaciones ?? '',
      });
    }
  }, [editOpen, log, reset]);

  /* ── Close dropdown on outside click ────────────────────── */

  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  /* ── Handlers ────────────────────────────────────────────── */

  const onEditSubmit = useCallback(
    (data: EditFormData) => {
      startTransition(async () => {
        const result = await editRecord({
          id: log.id,
          interpreterId: log.interpreterId ?? undefined,
          ...data,
          observaciones: data.observaciones || null,
        });
        if (result.success) {
          toast.success(result.message ?? 'Registro actualizado.');
          setEditOpen(false);
          router.refresh();
        } else {
          toast.error(result.error ?? 'No se pudo actualizar.');
        }
      });
    },
    [log.id, log.interpreterId, router],
  );

  const onDelete = useCallback(() => {
    startTransition(async () => {
      const result = await deleteRecord({
        id: log.id,
        interpreterId: log.interpreterId ?? undefined,
      });
      if (result.success) {
        toast.success(result.message ?? 'Registro eliminado.');
        setDeleteOpen(false);
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo eliminar.');
      }
    });
  }, [log.id, log.interpreterId, router]);

  /* ── Shared input classes ────────────────────────────────── */

  const baseInput =
    'min-w-0 w-full rounded-xl border bg-[var(--theme-control-bg)] px-4 py-2.5 text-[var(--theme-control-text)] placeholder:text-[var(--text-tertiary)] focus:outline-none transition-colors';

  const inputCls = cn(baseInput, 'border-[var(--theme-control-border)] focus:border-[var(--theme-focus)] focus:ring-2 focus:ring-[var(--theme-focus)]');
  const errorInputCls = cn(baseInput, 'border-[var(--theme-danger)] focus:border-[var(--theme-danger)] focus:ring-2 focus:ring-[var(--theme-danger)]');

  /* ── Inline error helper ─────────────────────────────────── */

  function FieldError({ name }: { name: keyof EditFormData }) {
    const err = errors[name];
    if (!err) return null;
    return <p id={`production-${log.id}-${name}-error`} className="text-xs text-[var(--theme-danger)] mt-1">{err.message}</p>;
  }

  /* ── Render ──────────────────────────────────────────────── */

  return (
    <>
      {/* ── Dropdown trigger ──────────────────────────────── */}
      <div ref={menuRef} className="relative inline-block text-left">
        <button
          type="button"
          ref={triggerRef}
          onClick={() => setMenuOpen((o) => !o)}
          className="theme-action-secondary p-2 rounded-xl transition-colors"
          aria-expanded={menuOpen}
          aria-label="Abrir acciones"
        >
          <MoreVertical size={20} />
        </button>

        {menuOpen && (
          <div className="absolute right-0 z-20 mt-2 w-44 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--theme-panel)] shadow-2xl">
            <button
              type="button"
              onClick={() => { triggerRef.current?.focus(); setEditOpen(true); setMenuOpen(false); }}
              className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-[var(--foreground)] hover:bg-[var(--theme-hover)]"
            >
              <Pencil size={16} /> Editar
            </button>
            <button
              type="button"
              onClick={() => { triggerRef.current?.focus(); setDeleteOpen(true); setMenuOpen(false); }}
              className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-[var(--theme-danger)] hover:bg-red-500/10"
            >
              <Trash2 size={16} /> Eliminar
            </button>
          </div>
        )}
      </div>

      <Modal isOpen={editOpen} onClose={() => setEditOpen(false)} title="Editar registro" maxWidth="max-w-lg">
        <p className="mb-4 text-sm text-[var(--text-secondary)]">{log.interpreterName}</p>
      <form onSubmit={handleSubmit(onEditSubmit)} noValidate>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Date */}
          <div>
            <label htmlFor={`production-${log.id}-date`} className="text-sm font-medium text-[var(--text-secondary)]">Fecha</label>
            <input
              type="date"
              id={`production-${log.id}-date`}
              aria-invalid={Boolean(errors.date)}
              aria-describedby={errors.date ? `production-${log.id}-date-error` : undefined}
              {...register('date')}
              className={errors.date ? errorInputCls : inputCls}
            />
            <FieldError name="date" />
          </div>

          {/* Status */}
          <div>
            <label htmlFor={`production-${log.id}-status`} className="text-sm font-medium text-[var(--text-secondary)]">Estado</label>
            <input
              id={`production-${log.id}-status`}
              aria-invalid={Boolean(errors.status)}
              aria-describedby={errors.status ? `production-${log.id}-status-error` : undefined}
              {...register('status')}
              className={errors.status ? errorInputCls : inputCls}
            />
            <FieldError name="status" />
          </div>

          {/* Interpreted Minutes */}
          <div>
            <label htmlFor={`production-${log.id}-interpretedMinutes`} className="text-sm font-medium text-[var(--text-secondary)]">Minutos</label>
            <input
              type="number"
              min={0}
              max={1440}
              id={`production-${log.id}-interpretedMinutes`}
              aria-invalid={Boolean(errors.interpretedMinutes)}
              aria-describedby={errors.interpretedMinutes ? `production-${log.id}-interpretedMinutes-error` : undefined}
              {...register('interpretedMinutes', { valueAsNumber: true })}
              className={errors.interpretedMinutes ? errorInputCls : inputCls}
            />
            <FieldError name="interpretedMinutes" />
          </div>

          {/* Calls Attended */}
          <div>
            <label htmlFor={`production-${log.id}-callsAttended`} className="text-sm font-medium text-[var(--text-secondary)]">Llamadas</label>
            <input
              type="number"
              min={0}
              id={`production-${log.id}-callsAttended`}
              aria-invalid={Boolean(errors.callsAttended)}
              aria-describedby={errors.callsAttended ? `production-${log.id}-callsAttended-error` : undefined}
              {...register('callsAttended', { valueAsNumber: true })}
              className={errors.callsAttended ? errorInputCls : inputCls}
            />
            <FieldError name="callsAttended" />
          </div>

          {/* Adherence */}
          <div className="sm:col-span-2">
            <label htmlFor={`production-${log.id}-adherence`} className="text-sm font-medium text-[var(--text-secondary)]">Adherencia (%)</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.01}
              id={`production-${log.id}-adherence`}
              aria-invalid={Boolean(errors.adherence)}
              aria-describedby={errors.adherence ? `production-${log.id}-adherence-error` : undefined}
              {...register('adherence', { valueAsNumber: true })}
              className={errors.adherence ? errorInputCls : inputCls}
            />
            <FieldError name="adherence" />
          </div>

          {/* Observaciones */}
          <div className="sm:col-span-2">
            <label htmlFor={`production-${log.id}-observaciones`} className="text-sm font-medium text-[var(--text-secondary)]">Observaciones</label>
            <textarea
              id={`production-${log.id}-observaciones`}
              aria-invalid={Boolean(errors.observaciones)}
              aria-describedby={errors.observaciones ? `production-${log.id}-observaciones-error` : undefined}
              {...register('observaciones')}
              rows={3}
              className={errors.observaciones ? errorInputCls : inputCls}
            />
            <FieldError name="observaciones" />
          </div>
        </div>

        {/* Actions */}
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={() => setEditOpen(false)}
            className="theme-action-secondary rounded-xl px-4 py-2 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex items-center gap-2 theme-action-primary rounded-xl px-4 py-2 font-semibold transition-colors"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
      </Modal>

      <Modal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} title="Eliminar registro" maxWidth="max-w-md">
      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        Esta acción eliminará el registro de producción de{' '}
        <span className="font-medium text-[var(--foreground)]">{log.interpreterName}</span>{' '}
        y actualizará las vistas relacionadas.
      </p>

      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button
          type="button"
          onClick={() => setDeleteOpen(false)}
          className="theme-action-secondary rounded-xl px-4 py-2 transition-colors"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={isPending}
          className="inline-flex items-center gap-2 theme-action-danger rounded-xl px-4 py-2 font-semibold transition-colors"
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {isPending ? 'Eliminando…' : 'Eliminar'}
        </button>
      </div>
      </Modal>
    </>
  );
}
