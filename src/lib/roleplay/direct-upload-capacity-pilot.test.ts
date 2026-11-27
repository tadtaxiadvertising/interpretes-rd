import { describe, expect, it } from 'vitest';
import { inspectExpandedRoleplayCapacityPilot, prepareRoleplayDirectUploadBatch,
  ROLEPLAY_DIRECT_UPLOAD_MAX_FILE_BYTES, ROLEPLAY_DIRECT_UPLOAD_MAX_TOTAL_BYTES } from './direct-upload-contract';
const batch = '00000000-0000-4000-8000-000000000001';
const mib = 1024 * 1024;
const files = (n: number, sizeBytes = mib) => Array.from({ length: n }, (_, order) => ({
  order, sizeBytes, mime: 'audio/mpeg', sha256: 'a'.repeat(64),
}));
describe('offline expanded roleplay capacity pilot', () => {
  it.each([26, 50])('inspects %i valid declarations without allowing live reservations', count => {
    expect(inspectExpandedRoleplayCapacityPilot(files(count))).toEqual({
      slots: count, declaredBytes: count * mib, worstCaseReservedBytes: count * 30 * mib, activationAuthorized: false,
    });
    expect(() => prepareRoleplayDirectUploadBatch(batch, files(count))).toThrow('INVALID_ROLEPLAY_UPLOAD_COUNT');
  });
  it('retains the aggregate byte cap, individual file cap and canonical order', () => {
    const exact = files(50, ROLEPLAY_DIRECT_UPLOAD_MAX_TOTAL_BYTES / 50);
    expect(inspectExpandedRoleplayCapacityPilot(exact).declaredBytes).toBe(ROLEPLAY_DIRECT_UPLOAD_MAX_TOTAL_BYTES);
    exact[49].sizeBytes++;
    expect(() => inspectExpandedRoleplayCapacityPilot(exact)).toThrow('INVALID_ROLEPLAY_UPLOAD_TOTAL_BYTES');
    expect(() => inspectExpandedRoleplayCapacityPilot(files(26, ROLEPLAY_DIRECT_UPLOAD_MAX_FILE_BYTES + 1))).toThrow('INVALID_ROLEPLAY_UPLOAD_SIZE_OR_ORDER');
    expect(() => inspectExpandedRoleplayCapacityPilot(files(51))).toThrow('INVALID_ROLEPLAY_UPLOAD_COUNT');
    const duplicate = files(26); duplicate[25].order = 24;
    expect(() => inspectExpandedRoleplayCapacityPilot(duplicate)).toThrow('INVALID_ROLEPLAY_UPLOAD_SIZE_OR_ORDER');
  });
});
