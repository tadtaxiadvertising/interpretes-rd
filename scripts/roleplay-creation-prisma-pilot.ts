import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  claimRoleplayCreation, completeRoleplayCreationInTransaction,
  fingerprintRoleplayCreation, InvalidRoleplayCreationKeyError,
} from '../src/lib/roleplay/creation-idempotency-ledger';
import { lookupRoleplayCreationReceipt } from '../src/lib/roleplay/creation-receipt';
import { collectRoleplayCreationAudioDigests } from '../src/lib/roleplay/creation-audio-digests';
import { recoverSingleRoleplayCreation } from '../src/lib/roleplay/creation-receipt-browser';

/**
 * Only called inside the existing disposable-database verifier, after the
 * hardened ledger and a minimal synthetic session table have been created.
 * No auth, HTTP server, real participant, Storage or notification is used.
 */
export async function verifyPrismaCreationLifecycle(first: PrismaClient, second: PrismaClient): Promise<void> {
  const actor = 'ci-prisma-actor';
  const otherActor = 'ci-prisma-other-actor';
  const key = randomUUID();
  const audios = await collectRoleplayCreationAudioDigests([
    new File(['synthetic audio fixture'], 'synthetic.mp3', { type: 'audio/mpeg' }),
  ]);
  const input = {
    participantType: 'interpreter' as const, participantId: 123, requiresBilingualOpening: false,
    libraryFingerprint: null, scenarios: [{ title: 'Synthetic scenario', durationLimitSec: 120, scriptPrompt: null }],
    audios,
  };
  const payloadHash = fingerprintRoleplayCreation(input);
  const changedHash = fingerprintRoleplayCreation({ ...input, requiresBilingualOpening: true });
  const claims = await Promise.all([
    claimRoleplayCreation(first, actor, key, payloadHash),
    claimRoleplayCreation(second, actor, key, payloadHash),
  ]);
  assert.deepEqual(claims.map(c => c.kind).sort(), ['CLAIMED', 'IN_PROGRESS']);
  assert.deepEqual(await claimRoleplayCreation(second, actor, key, changedHash), { kind: 'CONFLICT' });
  assert.deepEqual(await lookupRoleplayCreationReceipt(second, otherActor, key), { status: 'NOT_FOUND' });
  assert.deepEqual(await claimRoleplayCreation(second, otherActor, key, payloadHash), { kind: 'CLAIMED' });
  assert.deepEqual(await lookupRoleplayCreationReceipt(first, actor, key), { status: 'IN_PROGRESS' });

  // Real Prisma interactive transactions and real completion helper.
  // Only the session INSERT is a minimal fixture, not the full HTTP publisher.
  const ids = ['ci-prisma-session-a', 'ci-prisma-session-b'];
  const publish = (db: PrismaClient, id: string) => db.$transaction(async tx => {
    await tx.$executeRaw`INSERT INTO public.roleplay_sessions (id) VALUES (${id})`;
    await completeRoleplayCreationInTransaction(tx, {
      actorUserId: actor, requestKey: key, payloadHash, sessionIds: [id], skippedCount: 0, scenarioCount: 1,
    });
    return id;
  }, { timeout: 10000 });
  const results = await Promise.allSettled([publish(first, ids[0]), publish(second, ids[1])]);
  const success = results.filter(result => result.status === 'fulfilled');
  assert.equal(success.length, 1);
  const rejected = results.find(result => result.status === 'rejected');
  assert.ok(rejected?.reason instanceof InvalidRoleplayCreationKeyError);
  const winner = success[0].value;
  const sessions = await first.roleplaySession.findMany({ where: { id: { in: ids } }, select: { id: true } });
  assert.deepEqual(sessions, [{ id: winner }]);
  const receipt = await lookupRoleplayCreationReceipt(second, actor, key);
  assert.deepEqual(receipt, { status: 'COMPLETED', sessionIds: [winner], createdCount: 1, skippedCount: 0, scenarioCount: 1 });
  assert.deepEqual(await claimRoleplayCreation(second, actor, key, payloadHash), {
    kind: 'REPLAY', sessionIds: [winner], createdCount: 1, skippedCount: 0, scenarioCount: 1,
  });
  assert.deepEqual(await lookupRoleplayCreationReceipt(second, otherActor, key), { status: 'IN_PROGRESS' });

  // Model loss of the POST acknowledgment: the browser contract consumes
  // the actual database receipt via an in-process transport, not an HTTP call.
  const transport: typeof fetch = async (url, init) => {
    assert.equal(url, '/api/admin/roleplays/creation-receipt');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.body, JSON.stringify({ requestKey: key }));
    return Response.json({ success: true, data: await lookupRoleplayCreationReceipt(second, actor, key) });
  };
  assert.deepEqual(await recoverSingleRoleplayCreation(key, 1, transport), { status: 'COMPLETED', sessionId: winner });
  await first.$executeRaw`DELETE FROM public.roleplay_sessions WHERE id=${winner}`;
  assert.deepEqual(await lookupRoleplayCreationReceipt(second, actor, key), { status: 'REVIEW_REQUIRED' });
  assert.deepEqual(await recoverSingleRoleplayCreation(key, 1, transport), { status: 'REVIEW_REQUIRED' });
  assert.deepEqual(await claimRoleplayCreation(second, actor, key, payloadHash), { kind: 'IN_PROGRESS' });
  console.log('Isolated Prisma creation lifecycle: real claims, rollback, replay, actor isolation and browser receipt contract passed.');
}
