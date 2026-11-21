import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assessMemory, MIN_AVAILABLE_MIB, MIN_TOTAL_MIB } from './assert-build-memory.mjs';

const mem = (totalMiB, availableMiB) =>
  'MemTotal: ' + totalMiB * 1024 + ' kB\nMemAvailable: ' + availableMiB * 1024 + ' kB\n';

test('undersized 457 MiB VPS is rejected before package install', () => {
  assert.deepEqual(assessMemory({ memInfo: mem(457, 250) }), {
    ok: false, reason: 'TOTAL_TOO_LOW', totalMiB: 457, availableMiB: 250,
  });
});

test('restrictive container cgroup overrides a large host', () => {
  const result = assessMemory({
    memInfo: mem(8192, 7000), cgroupLimit: String(512 * 1024 * 1024),
    cgroupUsage: String(160 * 1024 * 1024),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'TOTAL_TOO_LOW');
  assert.equal(result.totalMiB, 512);
  assert.equal(result.availableMiB, 352);
});

test('too little unused capacity blocks build even on a large host', () => {
  const result = assessMemory({ memInfo: mem(8192, 512), cgroupLimit: 'max' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'AVAILABLE_TOO_LOW');
});

test('bounded and sufficiently available isolated builder passes', () => {
  const result = assessMemory({
    memInfo: mem(8192, 6000),
    cgroupLimit: String(4096 * 1024 * 1024),
    cgroupUsage: String(512 * 1024 * 1024),
  });
  assert.equal(result.ok, true);
  assert.equal(result.reason, 'OK');
  assert.ok(result.totalMiB >= MIN_TOTAL_MIB);
  assert.ok(result.availableMiB >= MIN_AVAILABLE_MIB);
});

test('unknown host or bounded cgroup usage fails closed', () => {
  assert.equal(assessMemory({ memInfo: 'no data' }).reason, 'MEMORY_UNKNOWN');
  assert.equal(assessMemory({
    memInfo: mem(8192, 6000), cgroupLimit: String(4096 * 1024 * 1024),
  }).reason, 'CGROUP_USAGE_UNKNOWN');
});

test('all production Dockerfiles check memory before npm installs', () => {
  for (const file of ['Dockerfile', 'Dockerfile.api', 'Dockerfile.worker']) {
    const source = readFileSync(file, 'utf8');
    const copy = source.indexOf('COPY scripts/ci/assert-build-memory.mjs');
    const guard = source.indexOf('RUN node scripts/ci/assert-build-memory.mjs');
    const compileGuard = source.lastIndexOf('RUN node scripts/ci/assert-build-memory.mjs');
    const install = source.indexOf('RUN npm');
    assert.ok(copy >= 0, file + ': memory guard script must be copied');
    assert.ok(guard > copy, file + ': memory guard must follow the COPY');
    assert.ok(install > guard, file + ': memory guard must run before npm ci');
    assert.ok(compileGuard > install, file + ': memory guard must be rechecked before compilation');
  }
});
