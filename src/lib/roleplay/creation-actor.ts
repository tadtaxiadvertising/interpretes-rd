import { validateAction } from '@/lib/auth/actions';
import { actorFromBearer } from '@/lib/api-auth';

/** Resolve only an authenticated administrator, never a client-supplied actor ID. */
export async function resolveRoleplayCreationActor(req: Request): Promise<string | null> {
  const auth = await validateAction('admin');
  if ('error' in auth || typeof auth.user?.userId !== 'string' ||
      !auth.user.userId.trim() || auth.user.userId.length > 256 || auth.user.role !== 'admin') {
    return null;
  }
  if (req.headers.has('authorization')) {
    const bearer = await actorFromBearer(req);
    if (!bearer || bearer.role !== 'admin' || bearer.userId !== auth.user.userId) return null;
  }
  return auth.user.userId;
}
