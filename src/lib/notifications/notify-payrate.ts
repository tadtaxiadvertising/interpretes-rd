import 'server-only';
import prisma from '@/lib/prisma';
import { publishNotificationEvent } from './publish-notification-event';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

type RateChange = { interpreterId: number; auditId: number; kind: 'general' | 'special' };
type RateRemoval = { interpreterId: number; rateId: number; kind: 'removed' };

/** The caller supplies a committed audit ID, never a client-provided recipient. */
export async function notifyPayrateChange(input: RateChange | RateRemoval): Promise<void> {
  const eventId = input.kind === 'removed' ? input.rateId : input.auditId;
  if (!Number.isSafeInteger(input.interpreterId) || input.interpreterId <= 0 ||
      !Number.isSafeInteger(eventId) || eventId <= 0) return;
  try {
    const profile = await prisma.userProfile.findUnique({
      where: { interpreterId: input.interpreterId },
      select: { id: true, role: true },
    });
    if (profile?.role?.toLowerCase() !== 'interpreter' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(profile.id)) return;
    await publishNotificationEvent({
      userId: profile.id,
      eventKey: (input.kind === 'removed' ? 'finance.payrate.removed:' : 'finance.payrate.changed:') + eventId,
      category: 'finance',
      type: 'info',
      title: input.kind === 'removed' ? 'Tarifa especial eliminada' : input.kind === 'general' ? 'Tarifa general actualizada' : 'Tarifa especial actualizada',
      message: input.kind === 'removed' ? 'Se ha eliminado una de tus tarifas especiales. Consulta tus ingresos y pagos para revisar las tarifas vigentes.' : 'Se ha actualizado una de tus tarifas. Consulta tus ingresos y pagos para revisar el valor vigente.',
      link: '/dashboard/earnings',
    });
  } catch (error) {
    // A committed financial change must never be repeated because its notice failed.
    console.warn('[PAYRATES] Saved but notification failed:', safeServerErrorCategory(error));
  }
}
