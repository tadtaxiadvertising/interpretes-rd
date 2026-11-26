import 'server-only';
import { createHash } from 'node:crypto';
import { prepareRoleplayDirectUploadBatch, ROLEPLAY_DIRECT_UPLOAD_MAX_FILE_BYTES, type PreparedRoleplayUpload } from './direct-upload-contract';
import { privateClinicalObjectPath, makePrivateClinicalReference } from './private-clinical-reference';
import { getAdminRoleplayAudioExtension } from './admin-audio-extension';
import { requirePrivateRoleplayAudioBucket } from './private-audio-bucket-readiness';
import { openReservedStorageObject, verifyReservedStorageObject } from './direct-upload-storage-verifier';
import type { FinalObjectPort } from './direct-upload-promote-slot';

type Storage = Pick<Parameters<typeof openReservedStorageObject>[0], 'getBucket'> & {
  from(bucket: string): ReturnType<Parameters<typeof openReservedStorageObject>[0]['from']> & {
    upload(path: string, body: Uint8Array, options: { upsert: false; contentType: string; cacheControl: string }): Promise<{ data: { path: string } | null; error: unknown }>;
  };
};

function canonicalPair(item: PreparedRoleplayUpload, destination: string) {
  const batchId = /^staging\/roleplay\/([0-9a-f-]{36})\//.exec(item.path)?.[1];
  const extension = getAdminRoleplayAudioExtension(item.mime);
  if (!batchId || !extension || !Number.isSafeInteger(item.order) || item.order < 0 || item.order >= 25 ||
      !Number.isSafeInteger(item.sizeBytes) || item.sizeBytes < 1 || item.sizeBytes > ROLEPLAY_DIRECT_UPLOAD_MAX_FILE_BYTES ||
      !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('INVALID_FINAL_OBJECT');
  const canonical = prepareRoleplayDirectUploadBatch(batchId, Array.from({length:item.order+1},(_,order)=>({
    order,mime:item.mime,sizeBytes:item.sizeBytes,sha256:item.sha256,
  }))).items[item.order];
  if (canonical.path !== item.path ||
      privateClinicalObjectPath(makePrivateClinicalReference(batchId,item.order,extension)) !== destination) {
    throw new Error('INVALID_FINAL_OBJECT');
  }
}

/** Staged adapter. Never accept raw client object paths. One bounded buffer,
 * no writes before validating source bytes, and no native copy with ambiguous
 * overwrite permissions. Caller still re-verifies destination independently.
 * The SDK client must have a bounded request timeout. */
export function createFinalClinicalStoragePort(storage: Storage, projectUrl: string, requestSignal?: AbortSignal): FinalObjectPort {
  let busy = false;
  return {
    async copyIfAbsent(item, destination) {
      canonicalPair(item,destination);
      if (busy || requestSignal?.aborted) throw new Error('FINAL_STORAGE_UNAVAILABLE');
      busy = true;
      try {
        const {stream,signal} = await openReservedStorageObject(storage,projectUrl,item,requestSignal);
        const buffer = new Uint8Array(item.sizeBytes);
        const reader = stream.getReader();
        const hash = createHash('sha256');
        let offset = 0;
        try {
          for (;;) {
            if (signal.aborted) throw new Error();
            const {done,value} = await reader.read();
            if (done) break;
            if (value.byteLength > buffer.length-offset) throw new Error();
            buffer.set(value,offset);
            hash.update(value);
            offset += value.byteLength;
          }
          if (signal.aborted || offset !== buffer.length || hash.digest('hex') !== item.sha256) throw new Error();
        } finally {
          await reader.cancel().catch(()=>{});
          reader.releaseLock();
        }
        if (requestSignal?.aborted) throw new Error();
        const bucket = await requirePrivateRoleplayAudioBucket(storage);
        if (requestSignal?.aborted) throw new Error();
        const result = await storage.from(bucket).upload(destination,buffer,{upsert:false,contentType:item.mime,cacheControl:'0'});
        if (result.error || result.data?.path !== destination) throw new Error();
      } catch {
        throw new Error('FINAL_STORAGE_UNAVAILABLE');
      } finally {
        busy = false;
      }
    },
    verify: (item) => verifyReservedStorageObject(storage,projectUrl,item,requestSignal),
  };
}
