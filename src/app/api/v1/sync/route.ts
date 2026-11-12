import { NextResponse } from 'next/server';
import { guardApiAuth } from '@/lib/api-auth';

/**
 * Historical CallSession backfill is intentionally paused.
 *
 * endCall() writes each live call into ProductionLog in the same transaction
 * that closes the session. Older sessions have no per-session reconciliation
 * ledger, so replaying them can duplicate minutes already present in daily
 * ProductionLog aggregates. A day-level observaciones marker is not sufficient
 * to establish which individual sessions were accounted for.
 *
 * Do not restore automatic writes here until a per-session idempotency ledger
 * and a reviewed legacy reconciliation procedure are in place.
 */
export async function GET(request: Request) {
  const denied = await guardApiAuth(request, 'admin');
  if (denied) return denied;

  return NextResponse.json(
    {
      success: false,
      code: 'LEGACY_BACKFILL_PAUSED',
      error: 'La sincronización histórica automática está pausada para evitar duplicar minutos de producción.',
      message: 'Las llamadas nuevas se registran directamente en ProductionLog al finalizar. Los registros históricos requieren una conciliación revisada antes de volver a importarse.',
    },
    { status: 409 }
  );
}
