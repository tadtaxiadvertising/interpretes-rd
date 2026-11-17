/**
 * HappyScribe admin endpoints intentionally use the browser's cookie session.
 * If the same HTTP request also supplies Authorization, its Bearer identity
 * must independently verify as the SAME admin. Never let a different or
 * malformed Bearer identity fall through to a privileged cookie session.
 *
 * Cookie-only requests retain their existing behavior. Bearer-only requests
 * are still rejected by the caller's cookie-bound validateAction check.
 */
export async function matchesExplicitAdminBearer(
  request: Request,
  cookieAdminUserId: string,
): Promise<boolean> {
  if (!request.headers.has('authorization')) return true;

  try {
    // Keep the Bearer/Prisma resolution off the cookie-only path.
    const { actorFromBearer } = await import('@/lib/api-auth');
    const bearer = await actorFromBearer(request);
    return bearer?.role === 'admin' && bearer.userId === cookieAdminUserId;
  } catch {
    return false;
  }
}
