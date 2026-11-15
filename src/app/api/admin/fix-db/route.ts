import { guardApiAuth } from '@/lib/api-auth';
import { privateRoleplayResponse } from '@/lib/roleplay/private-response';

/**
 * This legacy GET endpoint previously ran ALTER TABLE statements in
 * production. Database schema changes must only run through reviewed,
 * versioned migrations and the deployment pipeline. GET is intentionally
 * non-mutating and this endpoint is permanently retired.
 */
export async function GET(request: Request) {
  const denied = await guardApiAuth(request, 'admin');
  if (denied) return denied;

  return privateRoleplayResponse(
    {
      success: false,
      code: 'SCHEMA_PATCH_ENDPOINT_RETIRED',
      error: 'Database schema changes are managed by versioned migrations.',
    },
    { status: 410 },
  );
}
