import type { DirectReservationStatus } from './direct-reservation-status';

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
  PUBLICATION_RECORDED: 'El registro indica una publicación. Consulta las sesiones existentes para comprobar si sigue disponible.',
  CANCELLED: 'El registro indica una reserva cancelada. Solicita una revisión antes de iniciar otra creación.',
  REVIEW_REQUIRED: 'El registro requiere revisión administrativa.',
  UNAVAILABLE: 'No se pudo consultar el registro. Conserva la referencia y vuelve a consultar.',
  ACCESS_REQUIRED: 'Comprueba tu sesión administrativa y vuelve a consultar con la misma cuenta.',
  ENDPOINT_UNAVAILABLE: 'La consulta del registro todavía no está disponible.',
};

const states: readonly DirectReservationStatus[] = [
  'NOT_FOUND', 'RESERVED', 'VERIFIED', 'EXPIRED', 'PUBLICATION_RECORDED', 'CANCELLED', 'REVIEW_REQUIRED',
];

/** This observation cannot authorize any upload, signing or publication. */
export async function observeDirectReservation(requestKey: string, fetcher: typeof fetch = fetch): Promise<DirectReservationObservation> {
  if (!parseDirectReservationReference(requestKey) || requestKey !== requestKey.trim()) return 'UNAVAILABLE';
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function query(): Promise<DirectReservationObservation> {
    try {
      const res = await fetcher('/api/admin/roleplays/uploads/status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestKey }), cache: 'no-store', credentials: 'same-origin',
        redirect: 'error', signal: controller.signal,
      });
      if (res.status === 401 || res.status === 403) return 'ACCESS_REQUIRED';
      if (res.status === 404) return 'ENDPOINT_UNAVAILABLE';
      if (!res.ok) return 'UNAVAILABLE';
      const body = await res.json();
      const status: unknown = body?.success === true ? body.data?.status : null;
      return states.includes(status as DirectReservationStatus) ? status as DirectReservationStatus : 'UNAVAILABLE';
    } catch { return 'UNAVAILABLE'; }
  }
  try {
    return await Promise.race([
      query(),
      new Promise<DirectReservationObservation>(resolve => {
        timer = setTimeout(() => { resolve('UNAVAILABLE'); controller.abort(); }, 15_000);
      }),
    ]);
  } finally { clearTimeout(timer); }
}
