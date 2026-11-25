import { getResolvedIdentity } from '@/lib/auth/actions';
import { RoleplayClient } from './RoleplayClient';

interface SerializedIdentity {
  userId: string;
  profileId: string | null;
  interpreterId: number | null;
  candidateId: number | null;
  candidateHired: boolean;
  email: string | null;
  role: string;
  provider: 'supabase' | 'authjs';
  onboardingStatus: string;
  onboardingStep: string | null;
  onboardingVersion: number;
  onboardingCompletedAt: string | null;
  roleplayState: string;
  roleplaySessionId: string | null;
  eligibility: {
    canAccessDashboard: boolean;
    canStartRoleplay: boolean;
    needsOnboarding: boolean;
    needsRoleplay: boolean;
  };
}

function serializeIdentity(identity: any): SerializedIdentity | null {
  if (!identity) return null;
  return {
    ...identity,
    onboardingCompletedAt: identity.onboardingCompletedAt?.toISOString() ?? null,
  };
}

export default async function RoleplayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params;
  
  const identity = await getResolvedIdentity();
  const serializedIdentity = serializeIdentity(identity);
  
  return (
    <div className="theme-experience min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <RoleplayClient sessionId={sessionId} initialIdentity={serializedIdentity}
        openingEnabled={process.env.ROLEPLAY_BILINGUAL_OPENING_API_ENABLED === 'true' &&
          process.env.ROLEPLAY_BILINGUAL_OPENING_UI_ENABLED === 'true' &&
          (identity?.role === 'candidate' || identity?.role === 'interpreter')} />
    </div>
  );
}