import { describe, expect, it } from 'vitest';
import { DIRECT_UPLOAD_FORM_FLAGS, OPENING_ASSIGNMENT_FLAGS, readDirectUploadPilotConfig } from './direct-upload-pilot-config';

const flags = [...OPENING_ASSIGNMENT_FLAGS, ...DIRECT_UPLOAD_FORM_FLAGS];
const enabled = Object.fromEntries(flags.map(name => [name, 'true']));
describe('direct upload configuration inventory', () => {
  it.each(flags)('requires exact true for %s without enabling any flags', flag => {
    const result = readDirectUploadPilotConfig({ ...enabled, [flag]: 'TRUE' });
    expect(result.formConfigured).toBe(false);
    expect(result.flags.filter(item => !item.configured).map(item => item.name)).toEqual([flag]);
    expect(result.activationAuthorized).toBe(false);
  });

  it('keeps recovery available when the form is disabled', () => {
    const result = readDirectUploadPilotConfig({ ROLEPLAY_DIRECT_UPLOAD_RESERVATION_API_ENABLED: 'true' });
    expect(result.reservationLookupConfigured).toBe(true);
    expect(result.formConfigured).toBe(false);
  });

  it('reports presence only, including server URL fallback and blank values', () => {
    const result = readDirectUploadPilotConfig({
      ...enabled,
      SUPABASE_URL: 'https://synthetic-project.invalid',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-public-value',
      SUPABASE_SERVICE_ROLE_KEY: 'synthetic-private-value',
      FRONTEND_ORIGIN: '  ',
    });
    expect(result.formConfigured).toBe(true);
    expect(result.environmentValuesPresent).toBe(false);
    expect(result.requirements.filter(item => !item.present).map(item => item.label)).toEqual(['NEXT_PUBLIC_SUPABASE_URL', 'FRONTEND_ORIGIN']);
    expect(JSON.stringify(result)).not.toContain('synthetic-');
    expect(result.activationAuthorized).toBe(false);
  });

  it('never interprets all present values as activation approval', () => {
    const result = readDirectUploadPilotConfig({
      ...enabled,
      NEXT_PUBLIC_SUPABASE_URL: 'synthetic-url',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-public',
      SUPABASE_SERVICE_ROLE_KEY: 'synthetic-private',
      FRONTEND_ORIGIN: 'synthetic-origin',
    });
    expect(result.flags).toHaveLength(9);
    expect(result.formConfigured).toBe(true);
    expect(result.environmentValuesPresent).toBe(true);
    expect(result.activationAuthorized).toBe(false);
    expect(JSON.stringify(result)).not.toContain('synthetic-');
  });
});
