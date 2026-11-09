import { describe, expect, it } from 'vitest';
import { findMissingWorkerEnvVars } from './roleplay-audio-worker-config';

describe('findMissingWorkerEnvVars', () => {
  it('reports every required variable when the environment is empty', () => {
    expect(findMissingWorkerEnvVars({})).toEqual([
      'DATABASE_URL',
      'NEXT_PUBLIC_SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
    ]);
  });

  it('treats blank values as missing', () => {
    expect(
      findMissingWorkerEnvVars({
        DATABASE_URL: '   ',
        NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: '',
      }),
    ).toEqual(['DATABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  });

  it('passes when all required variables are configured', () => {
    expect(
      findMissingWorkerEnvVars({
        DATABASE_URL: 'postgresql://user:pass@host:6543/postgres',
        NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      }),
    ).toEqual([]);
  });
});
