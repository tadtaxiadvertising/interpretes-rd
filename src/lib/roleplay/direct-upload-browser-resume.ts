import { prepareRoleplayDirectUploadBatch, type RoleplayDirectUploadDeclaration } from './direct-upload-contract';
import { hashRoleplayFilesSequentially } from './direct-upload-browser-hash';
import type { RoleplayBrowserSignedUploadSlot, RoleplaySignedUploadTransfer } from './direct-upload-browser';

type Reservation = {kind:'CREATED'; batchId:string; expiresAt:string; slots:RoleplayBrowserSignedUploadSlot[]};
type Port = {
  reserve(key:string, declarations:readonly RoleplayDirectUploadDeclaration[], signal?:AbortSignal):Promise<unknown>;
  inspect(key:string, order:number, signal?:AbortSignal):Promise<unknown>;
  verify(key:string, order:number, signal?:AbortSignal):Promise<unknown>;
  transfer:RoleplaySignedUploadTransfer;
};
export type DirectUploadProgress = {phase:'hashing'|'reserving'|'uploading'|'verifying'|'ready'|'interrupted'; verified:number; total:number};
type Options = {signal?:AbortSignal; onProgress?:(progress:DirectUploadProgress)=>void};
type Hash = typeof hashRoleplayFilesSequentially;

export type DirectUploadReviewReason = 'RESERVATION_EXPIRED' | 'RESERVATION_UNCERTAIN';

/** The current controller cannot safely continue without reviewing the reservation. */
export class DirectUploadReviewRequired extends Error {
  readonly requestKey: string | null;

  constructor(readonly reason: DirectUploadReviewReason, requestKey?: unknown) {
    super('ROLEPLAY_UPLOAD_INTERRUPTED');
    this.name = 'DirectUploadReviewRequired';
    // A correlation ID, not a signed Storage token or invitation. Do not
    // include an arbitrary provider response in the review reference.
    this.requestKey = typeof requestKey === 'string' &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[47][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(requestKey)
      ? requestKey : null;
  }
}

function progressResult(value:unknown, total:number, order:number):number | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string,unknown>;
  if (v.kind !== 'PROGRESS' || v.total !== total || typeof v.verifiedCount !== 'number' ||
      !Number.isSafeInteger(v.verifiedCount) || v.verifiedCount <= order || v.verifiedCount > total ||
      v.complete !== (v.verifiedCount === total)) return null;
  return v.verifiedCount;
}

/** A single immutable draft in one browser tab. Tokens and files stay in a
 * closure, never localStorage or React progress state. A lost reserve reply
 * cannot be retried with a fresh key by this controller. No publication here.
 */
export function createRoleplayUploadController(files:readonly File[], port:Port,
  hash:Hash = hashRoleplayFilesSequentially) {
  const pendingFiles = new Map(files.map((file, order) => [order, file]));
  const total = files.length;
  const requestKey = crypto.randomUUID();
  let reservation:Reservation | null = null;
  let reservationRequested = false;
  let active = false;
  let verified = 0;
  const attempted = new Set<number>();

  function advanceVerified(count: number) {
    if (!reservation) throw new Error('UPLOAD_PLAN_INVALID');
    // Only a validated server acknowledgement advances the verified prefix.
    // Its slots no longer need a local file, signed capability or retry marker.
    for (let order = verified; order < count; order++) {
      reservation.slots[order].token = '';
      pendingFiles.delete(order);
      attempted.delete(order);
    }
    verified = count;
  }

  async function run(options:Options = {}) {
    if (active) throw new Error('UPLOAD_ALREADY_RUNNING');
    active = true;
    const check = () => {
      if (options.signal?.aborted) throw new Error('UPLOAD_INTERRUPTED');
      if (reservation && Date.now() >= Date.parse(reservation.expiresAt)) throw new DirectUploadReviewRequired('RESERVATION_EXPIRED', requestKey);
    };
    const emit = (phase:DirectUploadProgress['phase']) => {
      options.onProgress?.({phase,verified,total});
      check();
    };
    try {
      check();
      if (!reservation) {
        if (reservationRequested) throw new DirectUploadReviewRequired('RESERVATION_UNCERTAIN', requestKey);
        emit('hashing');
        const batch = Array.from(pendingFiles.values());
        const declarations = await hash(batch,{signal:options.signal});
        check();
        const normalized = prepareRoleplayDirectUploadBatch('123e4567-e89b-42d3-a456-426614174000',declarations);
        if (normalized.items.length !== total || normalized.items.some((item,i)=>!(batch[i] instanceof File) ||
            batch[i].size !== item.sizeBytes || batch[i].type !== item.mime)) throw new Error('UPLOAD_PLAN_INVALID');
        emit('reserving');
        reservationRequested = true;
        const raw = await port.reserve(requestKey,declarations,options.signal);
        if (!raw || typeof raw !== 'object') throw new Error('UPLOAD_PLAN_INVALID');
        const response = raw as Reservation;
        const expires = Date.parse(response.expiresAt);
        const canonical = prepareRoleplayDirectUploadBatch(response.batchId,declarations);
        if (response.kind !== 'CREATED' || !Number.isFinite(expires) || expires <= Date.now() ||
            expires > Date.now()+30*60_000 || !Array.isArray(response.slots) || response.slots.length !== total ||
            canonical.items.some((item,i)=>{
              const slot = response.slots[i];
              return !slot || typeof slot.token !== 'string' || !slot.token || slot.token.length > 8192 ||
                Object.entries(item).some(([key,value])=>slot[key as keyof RoleplayBrowserSignedUploadSlot] !== value);
            })) throw new Error('UPLOAD_PLAN_INVALID');
        reservation = {kind:'CREATED',batchId:response.batchId,expiresAt:response.expiresAt,
          slots:canonical.items.map((item,i)=>({...item,token:response.slots[i].token}))};
      }
      while (verified < total) {
        check();
        const order = verified;
        const slot = reservation.slots[order];
        let upload = true;
        if (attempted.has(order)) {
          const state = await port.inspect(requestKey,order,options.signal);
          check();
          const count = progressResult(state,total,order);
          if (count !== null) { advanceVerified(count); emit('verifying'); continue; }
          if (!state || typeof state !== 'object') throw new Error('UPLOAD_REVIEW_REQUIRED');
          const v = state as Record<string,unknown>;
          if (v.total !== total || v.verifiedCount !== order ||
              (v.kind !== 'PRESENT_UNVERIFIED' && v.kind !== 'NOT_OBSERVED')) throw new Error('UPLOAD_REVIEW_REQUIRED');
          upload = v.kind === 'NOT_OBSERVED';
        }
        if (upload) {
          emit('uploading');
          // Mark before I/O: even a thrown response may have committed bytes.
          const file = pendingFiles.get(order);
          if (!file || !slot.token) throw new Error('UPLOAD_PLAN_INVALID');
          attempted.add(order);
          const result = await port.transfer({path:slot.path,mime:slot.mime,token:slot.token},file,options.signal);
          check();
          if (!result || result.error !== null) throw new Error('UPLOAD_INTERRUPTED');
        }
        emit('verifying');
        const result = await port.verify(requestKey,order,options.signal);
        check();
        const count = progressResult(result,total,order);
        if (count !== order+1) throw new Error('UPLOAD_REVIEW_REQUIRED');
        advanceVerified(count);
      }
      emit('ready');
      // Verified slots have already relinquished their file references and tokens.
      return {requestKey,verifiedCount:verified,total};
    } catch (error) {
      // A provider exception may include a signed URL. Expose only a fixed
      // error; callers may invoke run again with the same controller.
      try { options.onProgress?.({phase:'interrupted',verified,total}); } catch { /* safe */ }
      if (error instanceof DirectUploadReviewRequired) throw new DirectUploadReviewRequired(error.reason, requestKey);
      if (reservationRequested && !reservation) throw new DirectUploadReviewRequired('RESERVATION_UNCERTAIN', requestKey);
      throw new Error('ROLEPLAY_UPLOAD_INTERRUPTED');
    } finally {
      active = false;
    }
  }
  // Expose only the original correlation UUID, never the signed slots.
  return {get requestKey() { return requestKey; },run};
}
