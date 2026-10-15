'use client';

import { useRouter } from 'next/navigation';
import { OnboardingWizard } from '@/components/OnboardingWizard';

interface OnboardingPageClientProps {
  interpreterName?: string;
  initialStep?: number;
}

/**
 * Client-only presentation wrapper. It receives serializable props from the
 * Server Component and handles navigation after the wizard completes.
 */
export function OnboardingPageClient({
  interpreterName,
  initialStep = 0,
}: OnboardingPageClientProps) {
  const router = useRouter();

  function handleComplete() {
    router.replace('/dashboard');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950">
      <OnboardingWizard
        onComplete={handleComplete}
        interpreterName={interpreterName}
        initialStep={initialStep}
      />
    </div>
  );
}
