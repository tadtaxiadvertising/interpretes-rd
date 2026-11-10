"use server";

import prisma from "@/lib/prisma";
import { validateAction } from "@/lib/auth/actions";
import type { ActionResult } from "@/lib/types";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { revalidateInterpreterProfileRecords } from "@/lib/cache/revalidate-interpreter";

const db = prisma;
const MAX_MINUTES_PER_LOG = 100_000;
const MAX_DB_AMOUNT = 99_999_999.99;

const DateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido")
  .refine((value) => {
    const parsed = new Date(`${value}T12:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Fecha inexistente");

const TimeSchema = z.string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Formato de hora inválido");

const ManualLogSchema = z.object({
  interpreterId: z.number().int().positive(),
  date: DateSchema,
  startTime: TimeSchema,
  endTime: TimeSchema,
  totalMinutes: z.number().int().min(0).max(MAX_MINUTES_PER_LOG),
});

/**
 * Creates an administrator-entered production log and its matching call session.
 * Input bounds protect integer and Decimal database columns from overflow.
 */
export async function createManualLog(data: unknown): Promise<ActionResult<{ id: number }>> {
  const auth = await validateAction("admin");
  if ("error" in auth) return { success: false, error: auth.error, code: auth.code };

  try {
    const validated = ManualLogSchema.parse(data);
    const { interpreterId, date, startTime, endTime, totalMinutes } = validated;

    const startDateTime = new Date(`${date}T${startTime}:00`);
    const endDateTime = new Date(`${date}T${endTime}:00`);
    const now = new Date();

    if (endDateTime <= startDateTime || endDateTime.getTime() - startDateTime.getTime() > 24 * 60 * 60 * 1000) {
      return { success: false, error: "La hora de fin debe ser posterior al inicio y dentro del mismo día.", code: "VALIDATION_ERROR" };
    }
    if (startDateTime > now || endDateTime > now) {
      return { success: false, error: "No se puede registrar tiempos en el futuro.", code: "VALIDATION_ERROR" };
    }

    const interpreter = await db.interpreter.findUnique({
      where: { id: interpreterId },
      select: { id: true, tariffPerMinute: true },
    });
    if (!interpreter) {
      return { success: false, error: "Intérprete no encontrado.", code: "NOT_FOUND" };
    }

    const durationSeconds = totalMinutes * 60;
    const tariffSnapshot = Number(interpreter.tariffPerMinute);
    const callCost = Math.round(totalMinutes * tariffSnapshot * 100) / 100;
    if (
      !Number.isFinite(tariffSnapshot) || tariffSnapshot < 0 ||
      !Number.isFinite(callCost) || callCost < 0 || callCost > MAX_DB_AMOUNT
    ) {
      return { success: false, error: "El importe calculado está fuera del rango permitido.", code: "VALIDATION_ERROR" };
    }

    const result = await db.$transaction(async (tx) => {
      const paidPayroll = await tx.payrollRecord.findFirst({
        where: {
          interpreterId,
          status: { in: ["PAID", "Paid"] },
          periodStart: { lte: new Date(`${date}T12:00:00Z`) },
          periodEnd: { gte: new Date(`${date}T12:00:00Z`) },
        },
        select: { id: true },
      });
      if (paidPayroll) return null;

      await tx.callSession.create({
        data: {
          interpreterId,
          startedAt: startDateTime,
          endedAt: endDateTime,
          durationSeconds,
          tariffSnapshot,
          callCost,
          notes: "Manual entry via Admin Server Action",
        },
      });

      return tx.productionLog.create({
        data: {
          interpreterId,
          date: new Date(`${date}T12:00:00Z`),
          loginTime: startDateTime,
          logoutTime: endDateTime,
          interpretedMinutes: totalMinutes,
          verifiedMinutes: totalMinutes,
          status: "Completed",
          observaciones: "Manual Sync (sin llamada de red interna)",
        },
        select: { id: true },
      });
    }, { isolationLevel: "Serializable" });

    if (!result) {
      return { success: false, error: "El período de nómina ya fue pagado y no puede modificarse.", code: "CONFLICT" };
    }

    revalidatePath("/admin/production");
    revalidateInterpreterProfileRecords(interpreter.id);
    return { success: true, data: { id: result.id } };
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return { success: false, error: "Datos de entrada inválidos", code: "VALIDATION_ERROR" };
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2034") {
      return { success: false, error: "El período de nómina cambió durante el registro. Recarga e inténtalo de nuevo.", code: "CONFLICT" };
    }
    console.error("createManualLog failed:", error instanceof Error ? error.message : "Unknown error");
    return { success: false, error: "Error interno al crear el log manual.", code: "INTERNAL_ERROR" };
  }
}

/** Returns interpreter choices only to administrators. */
export async function getInterpretersForSelect(searchQuery = ''): Promise<ActionResult<{ id: number; name: string; externalId: string }[]>> {
  const auth = await validateAction("admin");
  if ("error" in auth) return { success: false, error: auth.error, code: auth.code };

  const parsedSearch = z.string().trim().max(100).safeParse(searchQuery);
  if (!parsedSearch.success) {
    return { success: false, error: "Búsqueda inválida.", code: "VALIDATION_ERROR" };
  }

  try {
    const query = parsedSearch.data;
    const interpreters = await db.interpreter.findMany({
      where: query ? {
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { externalId: { contains: query, mode: "insensitive" } },
        ],
      } : undefined,
      select: { id: true, name: true, externalId: true },
      orderBy: { name: "asc" },
      take: 100,
    });
    return { success: true, data: interpreters };
  } catch (error: unknown) {
    console.error("getInterpretersForSelect failed:", error instanceof Error ? error.message : "Unknown error");
    return { success: false, error: "Error obteniendo la lista de intérpretes.", code: "INTERNAL_ERROR" };
  }
}
