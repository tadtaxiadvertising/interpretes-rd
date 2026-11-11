'use server';

import { getCurrentProfile } from '@/app/actions/auth';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const schema = z.object({
  interpreterId: z.coerce.number().int().positive(),
  accountId: z.coerce.number().int().positive(),
  startsAt: z.iso.date(),
  endsAt: z.union([z.iso.date(), z.literal('')]),
  notes: z.string().trim().max(500),
});

export async function createInterpreterAssignment(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== 'admin') return { success: false, error: 'Acceso no autorizado.' };
  const parsed = schema.safeParse(Object.fromEntries(['interpreterId', 'accountId', 'startsAt', 'endsAt', 'notes'].map(k => [k, formData.get(k) ?? ''])));
  if (!parsed.success) return { success: false, error: 'Revisa los datos y las fechas.' };
  const { interpreterId, accountId, startsAt, endsAt, notes } = parsed.data;
  if (endsAt && endsAt < startsAt) return { success: false, error: 'La fecha final no puede ser anterior al inicio.' };
  try {
    const interpreter = await prisma.interpreter.findFirst({
      where: { id: interpreterId, status: 'Activo' },
      select: { id: true },
    });
    if (!interpreter) {
      return { success: false, error: 'Solo se pueden asignar intérpretes activos. Los candidatos aún no están habilitados para producción.' };
    }

    await prisma.interpreterAccountAssignment.create({
      data: {
        interpreterId, accountId,
        startsAt: new Date(startsAt + 'T00:00:00.000Z'),
        endsAt: endsAt ? new Date(endsAt + 'T00:00:00.000Z') : null,
        notes: notes || null,
      },
    });
    revalidatePath('/admin/assignments');
    return { success: true };
  } catch (error) {
    console.error('[ASSIGNMENTS] Create failed', error);
    return { success: false, error: 'No se pudo crear la asignación. Comprueba que no se solapen fechas para la misma cuenta.' };
  }
}
