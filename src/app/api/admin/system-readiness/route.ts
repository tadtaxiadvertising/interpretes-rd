import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';
import { privateRoleplayResponse } from '@/lib/roleplay/private-response';
import { applyRateLimit, createRateLimitHeaders, RATE_LIMITS } from '@/lib/security/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface SchemaReadinessRow {
  accountHolderName: boolean;
  roleplayBaseAudioPath: boolean;
  responseSourceAudioPath: boolean;
  audioJobSourcePath: boolean;
  libraryArchiveTable: boolean;
}

/**
 * Read-only admin diagnostic, never used for Easypanel container liveness.
 * /api/health must remain unconditional liveness.
 */
export async function GET(req: NextRequest) {
  const auth = await validateAction('admin');
  if ('error' in auth) {
    return privateRoleplayResponse({ success: false, error: 'Access denied' }, { status: 403 });
  }

  const limit = applyRateLimit(req, RATE_LIMITS.sessionAccess);
  if (!limit.success) {
    return privateRoleplayResponse(
      { success: false, error: 'Too many requests' },
      { status: 429, headers: createRateLimitHeaders(limit) },
    );
  }

  try {
    // Static SQL. Checks schema/connection, never reads participant records.
    const [state] = await prisma.$queryRaw<SchemaReadinessRow[]>`
      SELECT
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'accounts' AND column_name = 'holder_name'
        ) AS "accountHolderName",
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'roleplay_sessions' AND column_name = 'base_audio_path'
        ) AS "roleplayBaseAudioPath",
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'roleplay_responses' AND column_name = 'source_audio_path'
        ) AS "responseSourceAudioPath",
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'roleplay_audio_jobs' AND column_name = 'source_audio_path'
        ) AS "audioJobSourcePath",
        EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'roleplay_library_archives'
        ) AS "libraryArchiveTable"
    `;

    if (!state) {
      return privateRoleplayResponse(
        { success: false, status: 'unavailable', error: 'Database readiness unavailable' },
        { status: 503 },
      );
    }

    const allPresent = Object.values(state).every(value => value === true);
    return privateRoleplayResponse(
      { success: allPresent, status: allPresent ? 'ready' : 'schema_mismatch', database: 'reachable', schema: state },
      { status: allPresent ? 200 : 503, headers: createRateLimitHeaders(limit) },
    );
  } catch (error: unknown) {
    console.error('[ADMIN_READINESS] database probe failed:', error instanceof Error ? 'Error' : 'UnknownError');
    return privateRoleplayResponse(
      { success: false, status: 'unavailable', error: 'Database readiness unavailable' },
      { status: 503 },
    );
  }
}
