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
  
  return <RoleplayClient sessionId={sessionId} initialIdentity={serializedIdentity} />;
}