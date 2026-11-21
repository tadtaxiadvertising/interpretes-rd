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

test('every Docker stage checks memory before npm install or compilation', () => {
  for (const file of ['Dockerfile', 'Dockerfile.api', 'Dockerfile.worker']) {
    const source = readFileSync(file, 'utf8');
    const stages = source.split(/(?=^FROM\s+)/m).filter(part => /^FROM\s/.test(part));
    let protectedStages = 0;
    for (const stage of stages) {
      const copy = stage.indexOf('COPY scripts/ci/assert-build-memory.mjs');
      const guard = stage.indexOf('RUN node scripts/ci/assert-build-memory.mjs');
      const install = stage.search(/^RUN\s+.*\bnpm\s+ci\b/m);
      const compile = stage.search(/^RUN\s+(?:npm\s+run\s+build|\.\/node_modules\/\.bin\/esbuild)\b/m);
      const commands = [install, compile].filter(position => position >= 0);
      if (!commands.length) continue;
      protectedStages++;
      const first = Math.min(...commands);
      assert.ok(copy >= 0, file + ': guard file missing from Docker stage');
      assert.ok(guard > copy, file + ': preflight must follow COPY in same Docker stage');
      assert.ok(guard < first, file + ': unprotected install or compilation');
      if (install >= 0 && compile >= 0) {
        const compileGuard = stage.lastIndexOf('RUN node scripts/ci/assert-build-memory.mjs', compile);
        assert.ok(compileGuard > install, file + ': memory must be rechecked after npm install');
      }
    }
    assert.equal(protectedStages, 2, file + ': builder and runner/deps stages must be audited');
  }
});
