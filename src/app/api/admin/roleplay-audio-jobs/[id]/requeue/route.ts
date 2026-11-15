import { NextRequest } from 'next/server';
import { requeueFailedRoleplayAudioJob } from '@/app/actions/roleplay-audio';
import { validateAction } from '@/lib/auth/actions';
import { actorFromBearer } from '@/lib/api-auth';
import { privateRoleplayResponse } from '@/lib/roleplay/private-response';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // The imported Server Action uses a cookie-bound admin identity. Validate
  // an explicitly supplied API Bearer against the same identity *before*
  // reading the job or changing its queue status.
  const auth = await validateAction('admin');
  if ('error' in auth) {
    return privateRoleplayResponse({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  if (req.headers.has('authorization')) {
    const bearer = await actorFromBearer(req);
    if (!bearer || bearer.role !== 'admin' || bearer.userId !== auth.user.userId) {
      return privateRoleplayResponse({ success: false, error: 'Forbidden' }, { status: 403 });
    }
  }

  const { id } = await params;
  const result = await requeueFailedRoleplayAudioJob({ jobId: id });
  if (!result.success) {
    const status =
      result.code === 'UNAUTHORIZED' ? 403
        : result.code === 'NOT_FOUND' ? 404
        : result.code === 'CONFLICT' ? 409
        : result.code === 'VALIDATION_ERROR' ? 400
        : 500;
    return privateRoleplayResponse(
      { success: false, error: result.error, code: result.code },
      { status },
    );
  }
  return privateRoleplayResponse({ success: true, data: { jobId: result.jobId } });
}
