import type { ProviderId } from './provider-catalog';
import type { ProviderQuota } from './provider-quota';
import { profileSelectionReadiness } from './profile-selection-readiness';
import { quotaAvailability } from './quota-availability';

type Profile = {
  id: string;
  provider: ProviderId;
  retiredAt: string | null;
  testAcceptedAt: string | null;
  receiptConfirmedAt: string | null;
};

/** Advisory local snapshot, not a failover decision or provider balance. */
export function providerAlternatives(profiles: readonly Profile[], quotas: readonly ProviderQuota[], preferredId: string | null) {
  const preferred = profiles.find(profile => profile.id === preferredId && !profile.retiredAt);
  const providerKnown = preferredId === null || !!preferred;
  const groups = new Map<ProviderId, { provider: ProviderId; remaining: number; profiles: number }>();
  let sharedProfiles = 0;
  for (const profile of profiles) {
    if (profile.id === preferredId) continue;
    const quota = quotas.find(q => q.provider === profile.provider);
    if (!quota || profileSelectionReadiness(profile, quota, true) !== 'ready') continue;
    if (preferred?.provider === profile.provider) {
      sharedProfiles++;
      continue;
    }
    const group = groups.get(profile.provider);
    if (group) group.profiles++;
    else groups.set(profile.provider, { provider: profile.provider, remaining: quotaAvailability(quota).remaining, profiles: 1 });
  }
  return { providerKnown, sharedProfiles, alternatives: providerKnown ? [...groups.values()].sort((a, b) => a.provider.localeCompare(b.provider)) : [] };
}
