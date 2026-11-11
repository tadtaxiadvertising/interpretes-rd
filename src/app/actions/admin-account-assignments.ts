'use server';

import { getCurrentProfile } from '@/app/actions/auth';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Fecha inválida.').transform(value => new Date(`${value}T00:00:00.000Z`));

const AssignmentInput = z.object({
  accountId: z.coerce.number().int().positive(),
  interpreterId: z.coerce.number().int().positive(),
  startsAt: DateOnly,
  endsAt: z.union([z.literal(''), DateOnly]).optional().transform(value => value || null),
  notes: z.string().trim().max(500).optional().default(''),
}).refine(value => !value.endsAt || value.endsAt >= value.startsAt, {
  message: 'La fecha final debe ser igual o posterior a la fecha inicial.',
  path: ['endsAt'],
});

export async function assignInterpreterToAccount(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== 'admin') return { success: false, error: 'Acceso no autorizado.' };

  const parsed = AssignmentInput.safeParse({
    accountId: formData.get('accountId'),
    interpreterId: formData.get('interpreterId'),
    startsAt: formData.get('startsAt'),
    endsAt: formData.get('endsAt') || '',
    notes: formData.get('notes') || '',
  });
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message || 'Datos de asignación inválidos.' };

  const { accountId, interpreterId, startsAt, endsAt, notes } = parsed.data;
  try {
    await prisma.$transaction(async tx => {
      const [account, interpreter] = await Promise.all([
        tx.account.findUnique({ where: { id: accountId }, select: { id: true } }),
        tx.interpreter.findUnique({ where: { id: interpreterId }, select: { id: true } }),
      ]);
      if (!account) throw new Error('ACCOUNT_NOT_FOUND');
      if (!interpreter) throw new Error('INTERPRETER_NOT_FOUND');

      const overlap = await tx.interpreterAccountAssignment.findFirst({
        where: {
          interpreterId,
          startsAt: { lte: endsAt ?? new Date('9999-12-31T00:00:00.000Z') },
          OR: [{ endsAt: null }, { endsAt: { gte: startsAt } }],
        },
        select: { id: true },
      });
      if (overlap) throw new Error('ASSIGNMENT_OVERLAP');

      await tx.interpreterAccountAssignment.create({
        data: { accountId, interpreterId, startsAt, endsAt, notes: notes || null },
      });
    }, { isolationLevel: 'Serializable' });

    revalidatePath('/admin/accounts');
    return { success: true };
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'ACCOUNT_NOT_FOUND') return { success: false, error: 'La cuenta seleccionada no existe.' };
    if (code === 'INTERPRETER_NOT_FOUND') return { success: false, error: 'El intérprete seleccionado no existe.' };
    if (code === 'ASSIGNMENT_OVERLAP') return { success: false, error: 'Este intérprete ya tiene una asignación que coincide con ese período.' };
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2034') {
      return { success: false, error: 'La asignación coincidió con otra operación simultánea. Actualiza e inténtalo de nuevo.' };
    }
    console.error('[ADMIN_ACCOUNTS] Assignment creation failed', error);
    return { success: false, error: 'No se pudo crear la asignación.' };
  }
}

const EndAssignmentInput = z.object({
  assignmentId: z.coerce.number().int().positive(),
  endsAt: DateOnly,
});

export async function endInterpreterAccountAssignment(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== 'admin') return { success: false, error: 'Acceso no autorizado.' };

  const parsed = EndAssignmentInput.safeParse({
    assignmentId: formData.get('assignmentId'),
    endsAt: formData.get('endsAt'),
  });
  if (!parsed.success) return { success: false, error: 'Indica una fecha final válida.' };

  try {
    const result = await prisma.interpreterAccountAssignment.updateMany({
      where: {
        id: parsed.data.assignmentId,
        startsAt: { lte: parsed.data.endsAt },
        OR: [{ endsAt: null }, { endsAt: { gt: parsed.data.endsAt } }],
      },
      data: { endsAt: parsed.data.endsAt },
    });
    if (!result.count) return { success: false, error: 'La asignación ya finalizó o no existe.' };
    revalidatePath('/admin/accounts');
    return { success: true };
  } catch (error) {
    console.error('[ADMIN_ACCOUNTS] Assignment end failed', error);
    return { success: false, error: 'No se pudo finalizar la asignación.' };
  }
}
