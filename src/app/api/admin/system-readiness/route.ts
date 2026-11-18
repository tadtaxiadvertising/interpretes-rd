import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { guardApiAuth } from '@/lib/api-auth';
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
  roleplayStudioColumns: boolean;
  roleplayStudioConstraints: boolean;
  accountPlatformVpnColumns: boolean;
  accountPlatformVpnPortConstraint: boolean;
}

/**
 * Read-only admin diagnostic, never used for Easypanel container liveness.
 * /api/health must remain unconditional liveness.
 */
export async function GET(req: NextRequest) {
  // Use the same Bearer-first actor resolution as the Edge API gate.
  // A cookie belonging to another admin must not override Authorization.
  const denied = await guardApiAuth(req, 'admin');
  if (denied) {
    denied.headers.set('Cache-Control', 'private, no-store');
    denied.headers.set('Vary', 'Cookie, Authorization');
    return denied;
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
        ) AS "libraryArchiveTable",
        (
          SELECT COUNT(*) = 5
          FROM (VALUES
            ('studio_turn', 'integer'),
            ('studio_speaker', 'text'),
            ('studio_language', 'text'),
            ('source_start_sec', 'double precision'),
            ('source_end_sec', 'double precision')
          ) AS expected(column_name, column_type)
          JOIN information_schema.columns AS actual
            ON actual.table_schema = 'public'
           AND actual.table_name = 'roleplay_scenarios'
           AND actual.column_name = expected.column_name
           AND actual.data_type = expected.column_type
           AND actual.is_nullable = 'YES'
        ) AS "roleplayStudioColumns",
        (
          SELECT COUNT(*) = 4
          FROM pg_constraint
          WHERE conrelid = to_regclass('public.roleplay_scenarios')
            AND contype = 'c'
            AND convalidated
            AND conname IN (
              'roleplay_scenarios_studio_turn_positive',
              'roleplay_scenarios_studio_speaker_valid',
              'roleplay_scenarios_studio_language_valid',
              'roleplay_scenarios_source_time_pair_valid'
            )
        ) AS "roleplayStudioConstraints",
        -- Check the exact same 11 nullable types used by the additive
        -- account-platform VPN migration; no account data is selected.
        (
          SELECT COUNT(*) = 11
          FROM (VALUES
            ('vpn_provider', 'text'),
            ('vpn_app', 'text'),
            ('vpn_username_hint', 'text'),
            ('vpn_secret_ref', 'text'),
            ('vpn_country', 'text'),
            ('vpn_region', 'text'),
            ('vpn_server', 'text'),
            ('vpn_exit_ip', 'text'),
            ('vpn_profile', 'text'),
            ('vpn_protocol', 'text'),
            ('vpn_port', 'integer')
          ) AS expected(column_name, column_type)
          JOIN information_schema.columns AS actual
            ON actual.table_schema = 'public'
           AND actual.table_name = 'account_platforms'
           AND actual.column_name = expected.column_name
           AND actual.data_type = expected.column_type
           AND actual.is_nullable = 'YES'
        ) AS "accountPlatformVpnColumns",
        -- A CHECK (true) with the expected name is not a valid VPN port guard.
        EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = to_regclass('public.account_platforms')
            AND conname = 'account_platforms_vpn_port_range'
            AND contype = 'c' AND convalidated
            AND regexp_replace(
              lower(pg_get_constraintdef(oid)), '["()[:space:]]', '', 'g'
            ) = 'checkvpn_portisnullorvpn_port>=1andvpn_port<=65535'
        ) AS "accountPlatformVpnPortConstraint"
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
