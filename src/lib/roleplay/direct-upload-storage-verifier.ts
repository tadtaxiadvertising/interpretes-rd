import 'server-only';
import type { PreparedRoleplayUpload } from './direct-upload-contract';
import { requirePrivateRoleplayAudioBucket } from './private-audio-bucket-readiness';
import { verifyRoleplayUploadByteStream } from './direct-upload-stream-verifier';

type Storage = Parameters<typeof requirePrivateRoleplayAudioBucket>[0] & {
  from(bucket: string): { createSignedUrl(path: string, seconds: number): Promise<{ data: { signedUrl: string } | null; error: unknown }> };
};

/** Only call with a canonical item reconstructed from a persisted reservation.
 * The private signed URL never leaves the server; no redirects or full buffers.
 */
export async function verifyReservedStorageObject(storage: Storage, projectUrl: string, item: PreparedRoleplayUpload,
  requestSignal?: AbortSignal) {
  try {
    const bucket = await requirePrivateRoleplayAudioBucket(storage);
    const signed = await storage.from(bucket).createSignedUrl(item.path, 120);
    if (signed.error || !signed.data?.signedUrl) throw new Error();
    const origin = new URL(projectUrl);
    const url = new URL(signed.data.signedUrl);
    if (origin.protocol !== 'https:' || url.origin !== origin.origin || url.username || url.password || url.hash ||
        url.pathname !== origin.pathname.replace(/\/$/, '') + '/storage/v1/object/sign/' + bucket + '/' + item.path ||
        !url.searchParams.get('token')) throw new Error();
    const timeout = AbortSignal.timeout(30_000);
    const signal = requestSignal ? AbortSignal.any([requestSignal, timeout]) : timeout;
    const response = await fetch(url, { signal, redirect: 'error', cache: 'no-store', headers: { 'Accept-Encoding': 'identity' } });
    const length = response.headers.get('content-length');
    const encoding = response.headers.get('content-encoding');
    if (response.status !== 200 || !response.body || (encoding && encoding !== 'identity') ||
        (length !== null && (!/^\d+$/.test(length) || Number(length) !== item.sizeBytes))) {
      await response.body?.cancel().catch(() => {});
      throw new Error();
    }
    return await verifyRoleplayUploadByteStream(response.body, item, signal);
  } catch {
    throw new Error('DIRECT_UPLOAD_OBJECT_UNVERIFIED');
  }
}
