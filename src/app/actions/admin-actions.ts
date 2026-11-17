"use server";

import { revalidatePath } from "next/cache";
import { revalidateInterpreterProfileRecords } from '@/lib/cache/revalidate-interpreter';
import { z } from "zod";
import prisma from "@/lib/prisma";
import { validateAction } from "@/lib/auth/actions";
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

export type AdminActionResult = {
  success: boolean;
  message?: string;
  error?: string;
};

const idSchema = z.coerce.number().int().positive();
const percentageSchema = z.coerce.number().min(0).max(100);

const EditRecordSchema = z.object({
  id: idSchema,
  interpreterId: z.coerce.number().int().positive().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener formato YYYY-MM-DD."),
  interpretedMinutes: z.coerce.number().int().min(0).max(1440),
  callsAttended: z.coerce.number().int().min(0).max(10000),
  adherence: percentageSchema,
  status: z.string().trim().min(1).max(40),
  observaciones: z.string().trim().max(1000).optional().nullable(),
});

const DeleteRecordSchema = z.object({
  id: idSchema,
  interpreterId: z.coerce.number().int().positive().optional(),
});


export async function editRecord(input: unknown): Promise<AdminActionResult> {
  const auth = await validateAction("admin");
  if ("error" in auth) return { success: false, error: auth.error };

  try {
    const data = EditRecordSchema.parse(input);
    const existing = await prisma.productionLog.findUnique({
      where: { id: data.id },
      select: { id: true, interpreterId: true },
    });

    if (!existing) return { success: false, error: "Registro no encontrado." };

    const updated = await prisma.productionLog.update({
      where: { id: data.id },
      data: {
        interpreterId: data.interpreterId ?? existing.interpreterId,
        date: new Date(`${data.date}T00:00:00.000Z`),
        interpretedMinutes: data.interpretedMinutes,
        verifiedMinutes: data.interpretedMinutes,
        callsAttended: data.callsAttended,
        adherence: data.adherence,
        status: data.status,
        observaciones: data.observaciones || null,
      },
      select: { interpreterId: true },
    });

    revalidatePath("/admin/production");
    revalidateInterpreterProfileRecords(existing.interpreterId);
    revalidateInterpreterProfileRecords(updated.interpreterId);

    return { success: true, message: "Registro actualizado correctamente." };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.issues[0]?.message ?? "Datos inválidos." };
    }
    console.error("🔴 ERROR [editRecord]:", safeServerErrorCategory(error));
    return { success: false, error: "Error interno al actualizar el registro." };
  }
}

export async function deleteRecord(input: unknown): Promise<AdminActionResult> {
  const auth = await validateAction("admin");
  if ("error" in auth) return { success: false, error: auth.error };

  try {
    const data = DeleteRecordSchema.parse(input);
    const existing = await prisma.productionLog.findUnique({
      where: { id: data.id },
      select: { id: true, interpreterId: true },
    });

    if (!existing) return { success: false, error: "Registro no encontrado." };

    await prisma.productionLog.delete({ where: { id: data.id } });

    revalidatePath("/admin/production");
    revalidateInterpreterProfileRecords(data.interpreterId ?? existing.interpreterId);

    return { success: true, message: "Registro eliminado correctamente." };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.issues[0]?.message ?? "Datos inválidos." };
    }
    console.error("🔴 ERROR [deleteRecord]:", safeServerErrorCategory(error));
    return { success: false, error: "Error interno al eliminar el registro." };
  }
}
