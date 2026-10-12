import { redirect } from 'next/navigation';
import {
  resolveCurrentIdentity,
  resolveDestination,
} from '@/lib/identity/resolve-user';

export const dynamic = 'force-dynamic';

/**
 * Root entry router.
 *
 * Next.js route groups such as "(entry)" do not become URL path segments.
 * Therefore the app's entry router must be served at "/" and must not
 * redirect to a non-existent "/entry" path.
 */
export default async function RootPage() {
  const identity = await resolveCurrentIdentity();

  if (!identity) {
    redirect('/login');
  }

  redirect(resolveDestination(identity));
}
