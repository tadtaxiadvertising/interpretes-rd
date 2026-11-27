import { fingerprintLocalMedia } from './long-media';
import type { StudioDraftSegment } from './draft';

export type ProductionStatus = 'transferred' | 'verified' | 'unconfirmed' | 'created';
const MAX_RECORDS = 100;
const fingerprints = new WeakMap<File, Promise<string>>();
const records = new Map<string, ProductionStatus>();
let transfer: { token: string; key: string } | null = null;

/** Advisory identity only: sampled source fingerprint plus ordered editorial fields.
 * Never used as authentication, integrity verification or server idempotency. */
export async function studioProductionKey(source: File, turns: readonly StudioDraftSegment[], mode: 'wav' | 'mp3') {
  let fingerprint = fingerprints.get(source);
  if (!fingerprint) {
    fingerprint = fingerprintLocalMedia(source);
    fingerprints.set(source, fingerprint);
    void fingerprint.catch(() => { if (fingerprints.get(source) === fingerprint) fingerprints.delete(source); });
  }
  const hash = await fingerprint;
  const canonical = [...turns].sort((a,b)=>a.start-b.start).map(t=>[
    t.start,t.end,t.title,t.scriptPrompt,t.responseLimit,t.speakerRole,t.language,
    t.ranges?.map(r=>[r.start,r.end]) ?? null,
  ]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([hash,mode,canonical])));
  return Array.from(new Uint8Array(digest), b=>b.toString(16).padStart(2,'0')).join('');
}

function record(key: string, status: ProductionStatus) {
  records.delete(key);
  records.set(key,status);
  if (records.size > MAX_RECORDS) records.delete(records.keys().next().value!);
}
export function productionStatus(key: string): ProductionStatus | undefined { return records.get(key); }

export function trackProductionTransfer(token: string, key: string) {
  if (!/^[a-f0-9]{64}$/.test(key)) return;
  transfer = {token,key};
  // Do not erase a previous confirmed or uncertain creation merely because
  // someone opens another assignment form for the same package.
  if (!records.has(key)) record(key,'transferred');
}

export function advanceProductionTransfer(token: string, status: Exclude<ProductionStatus,'transferred'>) {
  if (transfer?.token !== token) return;
  const key = transfer.key;
  const previous = records.get(key);
  if (status === 'verified' && (previous === 'created' || previous === 'unconfirmed')) return;
  if (status === 'unconfirmed' && previous === 'created') return;
  record(key,status);
}
