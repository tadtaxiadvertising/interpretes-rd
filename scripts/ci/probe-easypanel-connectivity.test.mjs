import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeEndpoint, runDiagnostic } from './probe-easypanel-connectivity.mjs';

const privatePath = 'synthetic-not-a-real-secret-webhook-987';
const syntheticUrl = `https://fake.example.invalid:8443/${privatePath}?token=SYNTHETIC_TOKEN`;

test('reports missing or malformed endpoints without exposing their values', async () => {
  assert.deepEqual(await probeEndpoint(''), { status: 'MISSING' });
  assert.deepEqual(await probeEndpoint('javascript:alert(1)'), { status: 'INVALID_URL' });
  assert.deepEqual(await probeEndpoint('https://admin:secret@fake.example.invalid/path'), { status: 'INVALID_URL' });
});

test('resolves and probes the TCP port without making a webhook HTTP request', async () => {
  const calls = [];
  const result = await probeEndpoint(syntheticUrl, {
    lookup: async (host) => { calls.push(['lookup', host]); return [{ address: '127.0.0.1', family: 4 }]; },
    dial: async (address, port, family) => { calls.push(['dial', address, port, family]); return 'CONNECTED'; },
  });
  assert.equal(result.status, 'TCP_REACHABLE');
  assert.deepEqual(calls, [['lookup', 'fake.example.invalid'], ['dial', '127.0.0.1', 8443, 4]]);
  assert.ok(!JSON.stringify(result).includes(privatePath));
});

test('sanitizes diagnostic errors and never echoes URLs, IPs, or secrets', async () => {
  const result = await probeEndpoint(syntheticUrl, {
    lookup: async () => { throw new Error(`private URL: ${syntheticUrl}`); },
  });
  assert.equal(result.status, 'DNS_FAILED');
  assert.ok(!JSON.stringify(result).includes(privatePath));
  assert.ok(!JSON.stringify(result).includes('fake.example.invalid'));
  const tcp = await probeEndpoint(syntheticUrl, {
    lookup: async () => [{ address: '203.0.113.99', family: 4 }],
    dial: async () => { throw new Error(`provider leaked ${syntheticUrl}`); },
  });
  assert.equal(tcp.status, 'TCP_UNREACHABLE');
  assert.equal(tcp.reason, 'TCP_ERROR');
  assert.ok(!JSON.stringify(tcp).includes('203.0.113.99'));
});

test('does not require valid endpoint secrets to produce safe operator output', async () => {
  const output = [];
  await runDiagnostic({ EASYPANEL_WEBHOOK_INTERPRETERS: '', EASYPANEL_WEBHOOK_API: 'not a url' }, (s) => output.push(s));
  assert.deepEqual(output.map((s) => JSON.parse(s).status), ['MISSING', 'INVALID_URL']);
  assert.ok(!output.join('\n').includes('not a url'));
});
