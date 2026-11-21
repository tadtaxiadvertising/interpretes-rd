import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const workflow = readFileSync('.github/workflows/prepare-offhost-image.yml', 'utf8');
const script = readFileSync('scripts/ci/build-image-offhost.sh', 'utf8');

test('off-host builds can only be manually requested, never pushed or scheduled', () => {
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^  (push|pull_request|schedule|repository_dispatch|workflow_run):/m);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /CONFIRMO_COMPILACION_FUERA_DEL_VPS/);
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.doesNotMatch(workflow, /runs-on: self-hosted/);
});

test('production endpoint and database secrets cannot enter either workflow job', () => {
  for (const sensitive of [
    'EASYPANEL_WEBHOOK', 'DIRECT_URL', 'DATABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
    'ssh ', 'kubectl ', 'docker service ', 'docker stack ', 'prisma migrate',
  ]) {
    assert.ok(!workflow.includes(sensitive), 'Unexpected production operation: ' + sensitive);
    assert.ok(!script.includes(sensitive), 'Unexpected builder operation: ' + sensitive);
  }
});

test('build-only job has no package write permission; publish is explicitly opt-in', () => {
  const build = workflow.split('  build-only:\n')[1]?.split('  publish-ghcr:\n')[0];
  const publish = workflow.split('  publish-ghcr:\n')[1];
  assert.ok(build && publish);
  assert.match(build, /inputs\.mode == 'build-only'/);
  assert.doesNotMatch(build, /packages: write|docker push|docker login/);
  assert.match(publish, /inputs\.mode == 'publish-ghcr'/);
  assert.match(publish, /packages: write/);
  assert.match(publish, /docker login ghcr\.io/);
  assert.match(publish, /docker push "\$OFFHOST_IMAGE"/);
  assert.doesNotMatch(workflow, /:latest\b/);
});

test('builder enforces GitHub-hosted runner and precise SHA before Docker work', () => {
  const sourceGuard = script.indexOf('RUNNER_ENVIRONMENT');
  const refGuard = script.indexOf('refs/heads/main');
  const dockerBuild = script.indexOf('docker build');
  assert.ok(sourceGuard >= 0 && refGuard > sourceGuard && dockerBuild > refGuard);
  assert.match(script, /github-hosted/);
  assert.match(script, /sha-\$\{GITHUB_SHA,,\}/);
  const result = spawnSync('bash', ['scripts/ci/build-image-offhost.sh', 'frontend'], {
    env: { PATH: process.env.PATH ?? '', GITHUB_ACTIONS: 'true',
      RUNNER_ENVIRONMENT: 'self-hosted', GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: 'a'.repeat(40), GITHUB_REPOSITORY: 'test/example' },
    encoding: 'utf8',
    timeout: 2000,
  });
  assert.equal(result.status, 78);
  assert.match(result.stderr, /refusing self-hosted\/VPS execution/);
});

test('frontend image configuration uses public build variables and fails closed if absent', () => {
  for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_API_URL']) {
    assert.ok(script.includes(key), key);
  }
  assert.doesNotMatch(workflow, /secrets\.NEXT_PUBLIC_/);
  assert.match(workflow, /vars\.RELEASE_NEXT_PUBLIC_API_URL/);
});
