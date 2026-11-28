import { ROLEPLAY_DIRECT_UPLOAD_MAX_SLOTS } from '@/lib/roleplay-limits';
import type { DirectReservationStatus, DirectReservationRecordedProgress } from './direct-reservation-status';

export type DirectReservationObservation = DirectReservationStatus | 'UNAVAILABLE' | 'ACCESS_REQUIRED' | 'ENDPOINT_UNAVAILABLE';
export function parseDirectReservationReference(value: string): string | null {
  const key = value.trim();
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[47][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(key) ? key : null;
}

export const directReservationObservationLabels: Record<DirectReservationObservation | 'CHECKING', string> = {
  CHECKING: 'Consultando el registro de la reserva…',
  NOT_FOUND: 'No se encontró una reserva para esta referencia y esta cuenta. Esto no demuestra que el intento haya fallado.',
  RESERVED: 'La reserva figura como registrada. No confirma la presencia ni la integridad de los audios.',
  VERIFIED: 'El registro indica que los audios fueron verificados. No confirma su publicación ni su disponibilidad actual.',
  EXPIRED: 'La reserva ha caducado. Solicita una revisión antes de iniciar otra creación.',
  PUBLICATION_CONFIRMED: 'La publicación registrada corresponde a una sesión existente según la consulta. No confirma la disponibilidad actual de los audios.',
  PUBLICATION_RECORDED: 'El registro indica una publicación. Consulta las sesiones existentes para comprobar si sigue disponible.',
  CANCELLED: 'El registro indica una reserva cancelada. Solicita una revisión antes de iniciar otra creación.',
  REVIEW_REQUIRED: 'El registro requiere revisión administrativa.',
  UNAVAILABLE: 'No se pudo consultar el registro. Conserva la referencia y vuelve a consultar.',
  ACCESS_REQUIRED: 'Comprueba tu sesión administrativa y vuelve a consultar con la misma cuenta.',
  ENDPOINT_UNAVAILABLE: 'La consulta del registro todavía no está disponible.',
};

export type DirectReservationObservationResult = {
  status: DirectReservationObservation;
  progress?: DirectReservationRecordedProgress;
  sessionId?: string;
};

function validatedProgress(status: DirectReservationStatus, value: unknown): DirectReservationRecordedProgress | undefined {
  if (!['RESERVED', 'VERIFIED', 'EXPIRED'].includes(status) || !value || typeof value !== 'object') return;
  const p = value as Record<string, unknown>;
  if (typeof p.total !== 'number' || !Number.isSafeInteger(p.total) || p.total < 1 || p.total > ROLEPLAY_DIRECT_UPLOAD_MAX_SLOTS ||
      typeof p.recordedVerifiedCount !== 'number' || !Number.isSafeInteger(p.recordedVerifiedCount) ||
      p.recordedVerifiedCount < 0 || p.recordedVerifiedCount > p.total ||
      (status === 'RESERVED' && p.recordedVerifiedCount === p.total) ||
      (status === 'VERIFIED' && p.recordedVerifiedCount !== p.total) ||
      typeof p.expiresAt !== 'string' || typeof p.observedAt !== 'string') return;
  const expires = Date.parse(p.expiresAt), observed = Date.parse(p.observedAt);
  if (!Number.isFinite(expires) || !Number.isFinite(observed) ||
      new Date(expires).toISOString() !== p.expiresAt || new Date(observed).toISOString() !== p.observedAt ||
      (status === 'EXPIRED') !== (observed >= expires) || expires - observed > 30 * 60_000) return;
  return { total: p.total, recordedVerifiedCount: p.recordedVerifiedCount, expiresAt: p.expiresAt, observedAt: p.observedAt };
}

const states: readonly DirectReservationStatus[] = [
  'NOT_FOUND', 'RESERVED', 'VERIFIED', 'EXPIRED', 'PUBLICATION_RECORDED', 'PUBLICATION_CONFIRMED', 'CANCELLED', 'REVIEW_REQUIRED',
];

/** This observation cannot authorize any upload, signing or publication. */
export async function observeDirectReservation(requestKey: string, fetcher: typeof fetch = fetch): Promise<DirectReservationObservationResult> {
  if (!parseDirectReservationReference(requestKey) || requestKey !== requestKey.trim()) return { status: 'UNAVAILABLE' };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function query(): Promise<DirectReservationObservationResult> {
    try {
      const res = await fetcher('/api/admin/roleplays/uploads/status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestKey }), cache: 'no-store', credentials: 'same-origin',
        redirect: 'error', signal: controller.signal,
      });
      if (res.status === 401 || res.status === 403) return { status: 'ACCESS_REQUIRED' };
      if (res.status === 404) return { status: 'ENDPOINT_UNAVAILABLE' };
      if (!res.ok) return { status: 'UNAVAILABLE' };
      const body = await res.json();
      const status: unknown = body?.success === true ? body.data?.status : null;
      if (!states.includes(status as DirectReservationStatus)) return { status: 'UNAVAILABLE' };
      const observedStatus = status as DirectReservationStatus;
      if (observedStatus === 'PUBLICATION_CONFIRMED') {
        const sessionId: unknown = body.data.sessionId;
        return typeof sessionId === 'string' && /^[a-zA-Z0-9_-]{5,120}$/.test(sessionId)
          ? { status: observedStatus, sessionId }
          : { status: 'REVIEW_REQUIRED' };
      }
      const progress = validatedProgress(observedStatus, body.data.progress);
      return { status: observedStatus, ...(progress ? { progress } : {}) };
    } catch { return { status: 'UNAVAILABLE' }; }
  }
  try {
    return await Promise.race([
      query(),
      new Promise<DirectReservationObservationResult>(resolve => {
        timer = setTimeout(() => { resolve({ status: 'UNAVAILABLE' }); controller.abort(); }, 15_000);
      }),
    ]);
  } finally { clearTimeout(timer); }
}
