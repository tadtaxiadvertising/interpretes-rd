import { fingerprintLocalMedia } from './long-media';
import type { StudioDraftSegment } from './draft';
import { STUDIO_RECOVERY_KEY, updateRecoveryProduction, type RecoveryProductionReceipt } from './recovery';

export type ProductionStatus = 'transferred' | 'verified' | 'unconfirmed' | 'created';
const MAX_RECORDS = 100;
const fingerprints = new WeakMap<File, Promise<string>>();
const records = new Map<string, ProductionStatus>();
let transfer: { token: string; key: string; expectedBackup?: string; backupUnavailable?: boolean } | null = null;

/** Advisory identity only: sampled source fingerprint plus ordered editorial fields.
 * Never used as authentication, integrity verification or server idempotency. */
export async function studioProductionKey(source: File, turns: readonly StudioDraftSegment[], mode: 'wav' | 'mp3') {
  // Fail before reading media if the browser cannot compute the package digest.
  if (typeof crypto === 'undefined' || !crypto.subtle) throw new Error('Seguimiento local requiere HTTPS o localhost.');
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

export function restoreProductionReceipts(receipts: readonly RecoveryProductionReceipt[]) {
  for (const {key,status} of receipts) {
    if (records.get(key) !== 'created') record(key,status);
  }
}
export function productionReceipts(keys: Iterable<string>): RecoveryProductionReceipt[] {
  const result: RecoveryProductionReceipt[] = [];
  for (const key of new Set(keys)) {
    const status = records.get(key);
    if (status === 'unconfirmed' || status === 'created') result.push({key,status});
  }
  return result.slice(-MAX_RECORDS);
}

export function trackProductionTransfer(token: string, key: string, expectedBackup?: string) {
  if (!/^[a-f0-9]{64}$/.test(key)) return;
  if (transfer?.token === token) {
    // Repeated navigation must not re-arm an invalidated backup or change
    // the package associated with an already tracked reference.
    if (transfer.key !== key) throw new Error('La referencia de producción ya corresponde a otro paquete.');
    return;
  }
  transfer = {token,key,expectedBackup};
  // Do not erase a previous confirmed or uncertain creation merely because
  // someone opens another assignment form for the same package.
  if (!records.has(key)) record(key,'transferred');
}

export function advanceProductionTransfer(token: string, status: Exclude<ProductionStatus,'transferred'>) {
  if (transfer?.token !== token) return;
  const key = transfer.key;
  const previous = records.get(key);
  if (status === 'verified') {
    if (previous !== 'created' && previous !== 'unconfirmed') record(key,status);
    return;
  }
  const durableStatus = previous === 'created' ? 'created' : status;
  record(key,durableStatus);
  if (transfer.backupUnavailable) return 'backup-changed' as const;
  if (transfer.expectedBackup === undefined) return;
  try {
    if (localStorage.getItem(STUDIO_RECOVERY_KEY) !== transfer.expectedBackup) throw new Error('Backup changed');
    const updated = updateRecoveryProduction(transfer.expectedBackup,{key,status:durableStatus});
    localStorage.setItem(STUDIO_RECOVERY_KEY,updated);
    transfer.expectedBackup = status === 'created' ? undefined : updated;
    return 'saved' as const;
  } catch {
    // Never recreate a deleted backup or overwrite another tab's work.
    transfer.expectedBackup = undefined;
    transfer.backupUnavailable = true;
    return 'backup-changed' as const;
  }
}
