import type { DirectReservationStatus } from './direct-reservation-status';

export type DirectReservationObservation = DirectReservationStatus | 'UNAVAILABLE' | 'ACCESS_REQUIRED' | 'ENDPOINT_UNAVAILABLE';
const states: readonly DirectReservationStatus[] = [
  'NOT_FOUND', 'RESERVED', 'VERIFIED', 'EXPIRED', 'PUBLICATION_RECORDED', 'CANCELLED', 'REVIEW_REQUIRED',
];

/** This observation cannot authorize any upload, signing or publication. */
export async function observeDirectReservation(requestKey: string, fetcher: typeof fetch = fetch): Promise<DirectReservationObservation> {
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
