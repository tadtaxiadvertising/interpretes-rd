import { test } from 'node:test';
import assert from 'node:assert/strict';
import { versionEndpoint, verifyEasypanelVersion } from './verify-easypanel-version.mjs';

const expectedSha = 'a'.repeat(40);
const otherSha = 'b'.repeat(40);
const baseUrl = 'https://interpretes.example/';
const noSleep = async () => {};

test('only accepts a clean HTTPS version endpoint', () => {
  assert.equal(versionEndpoint(baseUrl), 'https://interpretes.example/api/version');
  assert.equal(versionEndpoint('https://interpretes.example/api/version'),
    'https://interpretes.example/api/version');
  for (const url of ['http://interpretes.example/', 'https://a:b@interpretes.example/',
    'https://interpretes.example/elsewhere', 'https://interpretes.example/?token=secret',
    'https://interpretes.example/#something', '']) {
    assert.throws(() => versionEndpoint(url));
  }
});

test('confirms the exact runtime SHA, even after a prior release', async () => {
  const ids = [otherSha, expectedSha];
  const requests = [];
  const result = await verifyEasypanelVersion({
    baseUrl, expectedSha, attempts: 2, sleepFn: noSleep,
    fetchFn: async (url, init) => {
      requests.push({ url, init });
      return Response.json({ buildId: ids.shift() });
    },
  });
  assert.deepEqual(result, { sha: expectedSha, attempt: 2 });
  assert.equal(requests[0].url, 'https://interpretes.example/api/version');
  assert.equal(requests[0].init.cache, 'no-store');
  assert.equal(requests[0].init.redirect, 'error');
});

test('does not accept missing or fabricated provenance', async () => {
  await assert.rejects(
    verifyEasypanelVersion({ baseUrl, expectedSha, attempts: 2,
      sleepFn: noSleep, fetchFn: async () => Response.json({ buildId: null }) }),
    /missing_valid_provenance/,
  );
  await assert.rejects(
    verifyEasypanelVersion({ baseUrl, expectedSha, attempts: 1,
      fetchFn: async () => Response.json({ status: 'healthy' }) }),
    /missing_valid_provenance/,
  );
});

test('rejects an unchanged older release and identifies only its valid public SHA', async () => {
  await assert.rejects(
    verifyEasypanelVersion({ baseUrl, expectedSha, attempts: 2,
      sleepFn: noSleep, fetchFn: async () => Response.json({ buildId: otherSha }) }),
    error => error.message.includes('running_different_sha') &&
      error.message.includes('last_observed_sha=' + otherSha),
  );
});

test('diagnostics never print untrusted error text instead of a validated SHA', async () => {
  const secret = 'PRIVATE_PROVIDER_TOKEN=https://internal.invalid/secret';
  await assert.rejects(
    verifyEasypanelVersion({ baseUrl, expectedSha, attempts: 1,
      fetchFn: async () => Response.json({ buildId: secret }) }),
    error => error.message.includes('missing_valid_provenance') &&
      !error.message.includes(secret) &&
      !error.message.includes('last_observed_sha='),
  );
});

test('matches uppercase valid SHA without treating it as another release', async () => {
  const result = await verifyEasypanelVersion({
    baseUrl, expectedSha: expectedSha.toUpperCase(), attempts: 1,
    fetchFn: async () => Response.json({ buildId: expectedSha }),
  });
  assert.equal(result.sha, expectedSha.toUpperCase());
});

test('retry network errors without silently treating them as a deployment', async () => {
  let calls = 0;
  await assert.rejects(
    verifyEasypanelVersion({ baseUrl, expectedSha, attempts: 3,
      sleepFn: noSleep, fetchFn: async () => { calls++; throw Error('secret provider error'); } }),
    /unreachable_or_invalid_json/,
  );
  assert.equal(calls, 3);
});

test('requires a complete Git SHA', async () => {
  await assert.rejects(
    verifyEasypanelVersion({ baseUrl, expectedSha: 'abcd', attempts: 1 }),
    /40-character/,
  );
});
