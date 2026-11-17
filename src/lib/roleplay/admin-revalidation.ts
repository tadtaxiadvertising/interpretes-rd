/**
 * Roleplay session creation has already committed when this function runs.
 * Cache invalidation is best-effort: it must never turn a successful
 * assignment into a 500 response and invite an accidental duplicate retry.
 *
 * Keep the two independent paths isolated so a failure on the first does not
 * prevent refreshing the second. Do not log error objects or session details.
 */
export function revalidateCommittedRoleplayViews(
  revalidate: (path: string) => void,
): void {
  for (const path of ['/admin/roleplays', '/admin/roleplays/new'] as const) {
    try {
      revalidate(path);
    } catch {
      console.error('Committed roleplay: admin cache refresh failed');
    }
  }
}
