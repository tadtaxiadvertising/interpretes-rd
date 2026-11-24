import { evaluateDispatch, type DispatchSnapshot } from './dispatch-eligibility';
import { renderRecruitmentEmail, type RecruitmentEmailKind } from './recruitment-templates';

type FinalStatus = 'accepted' | 'unconfirmed' | 'cancelled';
export type DispatchResult = 'disabled' | 'not_claimed' | 'deferred' | FinalStatus | 'reconciliation_required';

/** Internal dependencies, never supplied by a client. The identity loader must
 * establish an immutable verified binding; no production adapter exists yet.
 * The claim must commit before sending; the send must not retry internally.
 */
export interface DispatchDependencies {
  load: (eventId: string) => Promise<DispatchSnapshot | null>;
  claim: (eventId: string) => Promise<{ eventId: string; kind: RecruitmentEmailKind } | null>;
  finish: (eventId: string, status: FinalStatus) => Promise<boolean>;
  send: (message: { recipient: string; subject: string; text: string; html: string }) => Promise<'accepted' | 'unconfirmed'>;
  now: () => Date;
}

/** Internal single-event orchestrator. No network or scheduling by itself. */
export async function dispatchRecruitmentEmail(
  eventId: string,
  enabled: boolean,
  deps: DispatchDependencies,
): Promise<DispatchResult> {
  if (!enabled) return 'disabled';
  let claim: Awaited<ReturnType<DispatchDependencies['claim']>>;
  try {
    const initial = await deps.load(eventId);
    if (!initial || initial.event.id !== eventId || evaluateDispatch(initial, deps.now()).status !== 'eligible') {
      return 'deferred';
    }
    claim = await deps.claim(eventId);
  } catch {
    // A claim may have committed before a connection failure. Do not retry here.
    return 'reconciliation_required';
  }
  if (!claim) return 'not_claimed';
  if (claim.eventId !== eventId) return 'reconciliation_required';

  let result: FinalStatus = 'cancelled';
  try {
    const snapshot = await deps.load(eventId);
    if (snapshot?.event.id === eventId) {
      const eligibility = evaluateDispatch(snapshot, deps.now());
      if (eligibility.status === 'eligible' && eligibility.kind === claim.kind) {
        const message = renderRecruitmentEmail(eligibility.kind);
        // Any error after attempting SMTP is ambiguous, not grounds for retry.
        result = 'unconfirmed';
        const outcome = await deps.send({ recipient: eligibility.recipient, ...message });
        if (outcome === 'accepted') result = 'accepted';
      }
    }
  } catch {
    // If the fresh lookup itself failed, leave the attempt unconfirmed for
    // reconciliation instead of guessing whether delivery happened.
    result = 'unconfirmed';
  }
  try {
    return await deps.finish(eventId, result) ? result : 'reconciliation_required';
  } catch {
    return 'reconciliation_required';
  }
}
