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

  // Resume at the first step the user has not completed yet, and keep the
  // completed-onboarding guard server-side so the wizard never flashes for a
  // finished user.
  let initialStep = 0;
  if (authResult.userId && user) {
    const result = await getOnboardingStatus();

    if (result.success && result.data) {
      const { termsAccepted, bankingComplete, onboardingComplete } = result.data;
      if (onboardingComplete) {
        redirect('/dashboard');
      }
      initialStep = !termsAccepted ? 0 : !bankingComplete ? 1 : 2;
    }
  }

  return (
    <OnboardingPageClient
      interpreterName={user?.name || 'Intérprete'}
      initialStep={initialStep}
    />
  );
}
