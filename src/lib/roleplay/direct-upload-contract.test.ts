import { describe, expect, it } from 'vitest';
import {
  prepareRoleplayDirectUploadBatch,
  ROLEPLAY_DIRECT_UPLOAD_MAX_FILE_BYTES,
  ROLEPLAY_DIRECT_UPLOAD_MAX_TOTAL_BYTES,
} from './direct-upload-contract';

const batchId = '123e4567-e89b-42d3-a456-426614174000';
const sha = 'a'.repeat(64);
const file = (order: number, mime = 'audio/mpeg', sizeBytes = 3) =>
  ({ order, mime, sizeBytes, sha256: sha });

describe('future Roleplay direct-upload declaration (not a signed URL issuer)', () => {
  it('prepares 25 deterministic, server-namespaced paths without user filenames', () => {
    const batch = prepareRoleplayDirectUploadBatch(batchId,
      Array.from({ length: 25 }, (_, index) => file(index, 'audio/mpeg', ROLEPLAY_DIRECT_UPLOAD_MAX_FILE_BYTES)));
    expect(batch.items).toHaveLength(25);
    expect(batch.totalBytes).toBe(ROLEPLAY_DIRECT_UPLOAD_MAX_TOTAL_BYTES);
    expect(batch.items[0].path).toBe('staging/roleplay/' + batchId + '/0.mp3');
    expect(batch.items[24].path).toBe('staging/roleplay/' + batchId + '/24.mp3');
    expect(batch.items.every(item => item.sha256 === sha)).toBe(true);
  });

  it('preserves supported audio MIME types while deriving safe extensions', () => {
    const input = ['audio/mpeg', 'audio/wav', 'audio/webm', 'audio/mp4'].map((mime, order) => file(order, mime));
    const result = prepareRoleplayDirectUploadBatch(batchId, input);
    expect(result.items.map(x => x.path.slice(x.path.lastIndexOf('.')))).toEqual(['.mp3', '.wav', '.webm', '.mp4']);
    expect(result.totalBytes).toBe(12);
  });

  it('rejects count boundaries without dropping the 25th scenario', () => {
    expect(() => prepareRoleplayDirectUploadBatch(batchId, [])).toThrow('INVALID_ROLEPLAY_UPLOAD_COUNT');
    expect(() => prepareRoleplayDirectUploadBatch(batchId, Array.from({ length: 26 }, (_, index) => file(index))))
      .toThrow('INVALID_ROLEPLAY_UPLOAD_COUNT');
  });

  it('rejects malformed paths and forged batches', () => {
    for (const id of ['../../../escape', 'my-client-batch', '', batchId.toUpperCase(), '00000000-0000-0000-0000-000000000000']) {
      expect(() => prepareRoleplayDirectUploadBatch(id, [file(0)]))
        .toThrow('INVALID_ROLEPLAY_UPLOAD_BATCH_ID');
    }
    expect(() => prepareRoleplayDirectUploadBatch(batchId, [{ ...file(0), path: '../../outside' }]))
      .toThrow('INVALID_ROLEPLAY_UPLOAD_DECLARATION');
    expect(() => prepareRoleplayDirectUploadBatch(batchId, [{ ...file(0), signedUrl: 'https://evil.invalid' }]))
      .toThrow('INVALID_ROLEPLAY_UPLOAD_DECLARATION');
    expect(() => prepareRoleplayDirectUploadBatch(batchId, [{ ...file(0), fileName: 'private-patient.mp3' }]))
      .toThrow('INVALID_ROLEPLAY_UPLOAD_DECLARATION');
  });

  it('rejects order mismatch, duplicate slots and invalid file sizes', () => {
    const cases = [
      [file(1)],
      [file(0), file(0)],
      [file(0, 'audio/mpeg', 0)],
      [file(0, 'audio/mpeg', -1)],
      [file(0, 'audio/mpeg', 1.5)],
      [file(0, 'audio/mpeg', ROLEPLAY_DIRECT_UPLOAD_MAX_FILE_BYTES + 1)],
      [file(0, 'audio/mpeg', Number.POSITIVE_INFINITY)],
    ];
    for (const input of cases) {
      expect(() => prepareRoleplayDirectUploadBatch(batchId, input))
        .toThrow('INVALID_ROLEPLAY_UPLOAD_SIZE_OR_ORDER');
    }
  });

  it('rejects unsupported MIME and invalid SHA without reflecting private input', () => {
    for (const input of [
      file(0, 'application/octet-stream'),
      file(0, 'audio/mpeg; name=/etc/private'),
      { ...file(0), sha256: 'not-a-digest' },
      { ...file(0), sha256: 'A'.repeat(64) },
      { ...file(0), sha256: 'sensitive-patient-id' },
    ]) {
      expect(() => prepareRoleplayDirectUploadBatch(batchId, [input]))
        .toThrow('INVALID_ROLEPLAY_UPLOAD_MEDIA_OR_DIGEST');
    }
  });

  it('rejects non-record declarations without granting any capabilities', () => {
    for (const invalid of [null, 'audio', [], 123, true, { ...file(0), extra: 1 }]) {
      expect(() => prepareRoleplayDirectUploadBatch(batchId, [invalid])).toThrow();
    }
  });
});
