import { describe, it, expect } from 'vitest';
import { RecruitmentCandidatePatchSchema } from '@/lib/api-schemas';

describe('RecruitmentCandidatePatchSchema', () => {
  it('accepts a partial update with the editable fields', () => {
    const result = RecruitmentCandidatePatchSchema.parse({ telefono: '+1 555 0100', pais: 'MX' });
    expect(result).toEqual({ telefono: '+1 555 0100', pais: 'MX' });
  });

  it('strips the legacy status so it cannot be set through the API', () => {
    const result = RecruitmentCandidatePatchSchema.parse({ name: 'Ana', status: 'Contratado' });
    expect(result).toEqual({ name: 'Ana' });
    expect('status' in result).toBe(false);
  });
});
