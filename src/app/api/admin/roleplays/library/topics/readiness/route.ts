import { NextRequest } from 'next/server';
import { validateAction } from '@/lib/auth/actions';
import { actorFromBearer } from '@/lib/api-auth';
import { privateRoleplayResponse } from '@/lib/roleplay/private-response';
import { readRoleplayTopicsReadiness } from '@/lib/roleplay-topics-readiness';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const auth = await validateAction('admin');
    if ('error' in auth) return privateRoleplayResponse({ success: false, error: 'Acceso denegado.' }, { status: 403 });
    if (req.headers.has('authorization')) {
      const bearer = await actorFromBearer(req);
      if (!bearer || bearer.role !== 'admin' || bearer.userId !== auth.user.userId)
        return privateRoleplayResponse({ success: false, error: 'Acceso denegado.' }, { status: 403 });
    }
    const result = await readRoleplayTopicsReadiness();
    return privateRoleplayResponse({ success: true, data: result });
  } catch {
    return privateRoleplayResponse({ success: false, error: 'No se pudo comprobar la configuración. No se realizaron cambios.' }, { status: 503 });
  }
}
