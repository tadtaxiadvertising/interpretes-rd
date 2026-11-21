import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assessOffhostApproval, REQUIRED_WORKFLOWS, verifyReleaseGate } from './verify-offhost-release-gate.mjs';

const sha = 'a'.repeat(40);
const goodRun = (path, id) => ({
  id, path, event: 'push', head_sha: sha, head_branch: 'main',
  status: 'completed', conclusion: 'success',
});
const passes = REQUIRED_WORKFLOWS.map((path, index) => goodRun(path, index + 10));
const evidence = (overrides = {}) => ({
  expectedSha: sha, branchSha: sha, workflowRuns: passes, totalCount: passes.length, ...overrides,
});

test('approves the current main SHA only when three exact push workflows are green', () => {
  assert.deepEqual(assessOffhostApproval(evidence()), { ok: true, code: 'APPROVED' });
  for (const required of REQUIRED_WORKFLOWS) {
    assert.equal(assessOffhostApproval(evidence({
      workflowRuns: passes.filter(run => run.path !== required),
      totalCount: passes.length - 1,
    })).code, 'MISSING_CHECK');
  }
});

test('does not treat pending or failed newer attempt as an earlier success', () => {
  for (const conclusion of ['failure', null, 'cancelled']) {
    const newer = {
      ...goodRun(REQUIRED_WORKFLOWS[0], 999), conclusion,
      status: conclusion === null ? 'in_progress' : 'completed',
    };
    assert.equal(assessOffhostApproval(evidence({
      workflowRuns: [...passes, newer], totalCount: 4,
    })).code, 'CHECK_NOT_GREEN');
  }
});

test('rejects moved main, other refs and incomplete/ambiguous results', () => {
  assert.equal(assessOffhostApproval(evidence({ branchSha: 'b'.repeat(40) })).code, 'MAIN_MOVED');
  assert.equal(assessOffhostApproval(evidence({ workflowRuns: [], totalCount: 101 })).code, 'INCOMPLETE_EVIDENCE');
  assert.equal(assessOffhostApproval(evidence({ branchSha: undefined })).code, 'INVALID_SHA');
  for (const changes of [
    { event: 'pull_request' }, { head_branch: 'feature' }, { head_sha: 'b'.repeat(40) },
  ]) {
    const other = passes.map(run => ({ ...run, ...changes }));
    assert.equal(assessOffhostApproval(evidence({ workflowRuns: other })).code, 'MISSING_CHECK');
  }
});

test('GitHub API is read-only; failed context never attempts network', async () => {
  const env = {
    GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'self-hosted',
    GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: sha, GITHUB_REPOSITORY: 'test/example', GITHUB_TOKEN: 'synthetic-only',
  };
  let count = 0;
  const fetchFn = async (url, options) => {
    count++;
    assert.equal(options.headers.Authorization, 'Bearer synthetic-only');
    assert.match(url, /^https:\/\/api\.github\.com\/repos\/test\/example\//);
    return {
      ok: true, json: async () => url.endsWith('/branches/main')
        ? { commit: { sha } }
        : { total_count: passes.length, workflow_runs: passes },
    };
  };
  assert.equal((await verifyReleaseGate(env, fetchFn)).code, 'INVALID_CONTEXT');
  assert.equal(count, 0);
  env.RUNNER_ENVIRONMENT = 'github-hosted';
  assert.deepEqual(await verifyReleaseGate(env, fetchFn), { ok: true, code: 'APPROVED' });
  assert.equal(count, 2);
});

test('builder verifies checks before Docker and publisher rechecks before registry login', () => {
  const workflow = readFileSync('.github/workflows/prepare-offhost-image.yml', 'utf8');
  const script = readFileSync('scripts/ci/build-image-offhost.sh', 'utf8');
  assert.ok(script.indexOf('node scripts/ci/verify-offhost-release-gate.mjs') >= 0);
  assert.ok(script.indexOf('node scripts/ci/verify-offhost-release-gate.mjs') < script.indexOf('docker build'));
  assert.equal((workflow.match(/actions: read/g) || []).length, 2);
  assert.equal((workflow.match(/GITHUB_TOKEN: \$\{\{ github\.token \}\}/g) || []).length, 3);
  const recheck = workflow.indexOf('Recheck approved main SHA before GHCR publication');
  const login = workflow.indexOf('Authenticate only to GitHub Container Registry');
  const push = workflow.indexOf('docker push "$OFFHOST_IMAGE"');
  assert.ok(recheck > 0 && login > recheck && push > login);
  assert.doesNotMatch(workflow, /^  (push|schedule|pull_request):/m);
});
