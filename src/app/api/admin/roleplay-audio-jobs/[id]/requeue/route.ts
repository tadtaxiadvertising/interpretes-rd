import { NextRequest, NextResponse } from 'next/server';
import { requeueFailedRoleplayAudioJob } from '@/app/actions/roleplay-audio';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await requeueFailedRoleplayAudioJob({ jobId: id });
  if (!result.success) {
    const status =
      result.code === 'UNAUTHORIZED' ? 403
        : result.code === 'NOT_FOUND' ? 404
        : result.code === 'CONFLICT' ? 409
        : result.code === 'VALIDATION_ERROR' ? 400
        : 500;
    return NextResponse.json({ success: false, error: result.error, code: result.code }, { status });
  }
  return NextResponse.json({ success: true, data: { jobId: result.jobId } });
}
