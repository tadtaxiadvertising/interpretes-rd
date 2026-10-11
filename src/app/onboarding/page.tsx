import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getOnboardingStatus } from '@/app/actions/onboarding';
import { OnboardingPageClient } from './OnboardingPageClient';

/**
 * Authentication and database reads must stay in the Server Component.
 * Do not add 'use client' here: auth() reaches Prisma and the Node pg driver.
 */
export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const authResult = await auth();
  const user = authResult.user;

  // Keep the completed-onboarding guard server-side so users do not see the
  // wizard flash before being redirected to the dashboard.
  if (authResult.userId && user) {
    const result = await getOnboardingStatus();

    if (result.success && result.data?.onboardingComplete) {
      redirect('/dashboard');
    }
  }

  return (
    <OnboardingPageClient interpreterName={user?.name || 'Intérprete'} />
  );
}
