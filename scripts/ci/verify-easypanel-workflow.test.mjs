import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const workflow = readFileSync(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8');

function jobBody(job) {
  const lines = workflow.split('\n');
  const start = lines.findIndex(line => line === `  ${job}:`);
  assert.notEqual(start, -1, `Missing workflow job ${job}`);
  const rest = lines.slice(start + 1);
  const nextJob = rest.findIndex(line => /^  [a-z][a-z0-9-]*:$/.test(line));
  return (nextJob === -1 ? rest : rest.slice(0, nextJob)).join('\n');
}

test('a frontend runtime SHA mismatch cannot suppress the backend webhook job', () => {
  const frontend = jobBody('deploy-interpreters');
  const backend = jobBody('deploy-interpreters-api');
  const verifier = jobBody('verify-easypanel-frontend');
  assert.match(frontend, /Call Easypanel Webhook — interpreters/);
  assert.doesNotMatch(frontend, /verify-easypanel-version\.mjs|EASYPANEL_RELEASE_VERIFY_URL/);
  assert.match(backend, /needs: \[validate, deploy-interpreters\]/);
  assert.match(backend, /Call Easypanel Webhook — interpreters-api/);
  assert.match(verifier, /needs: \[validate, deploy-interpreters, deploy-interpreters-api, deploy-roleplay-audio-worker\]/);
  assert.match(verifier, /needs\.deploy-roleplay-audio-worker\.result == 'skipped'/);
  assert.match(verifier, /needs\.deploy-roleplay-audio-worker\.result == 'success'/);
  assert.match(verifier, /!cancelled\(\)/);
});

test('runtime verification is still fail-closed after the backend request', () => {
  const verifier = jobBody('verify-easypanel-frontend');
  assert.match(verifier, /name: Verify live Easypanel frontend SHA \(opt-in\)/);
  assert.match(verifier, /Check main HEAD before live version verification/);
  assert.match(verifier, /if: steps\.verify_head\.outputs\.current == 'true'/);
  assert.match(verifier, /node scripts\/ci\/verify-easypanel-version\.mjs/);
  assert.doesNotMatch(verifier, /continue-on-error: true/);
  assert.match(workflow, /node --test scripts\/ci\/verify-easypanel-version\.test\.mjs scripts\/ci\/verify-easypanel-workflow\.test\.mjs/);
});

test('manual runtime SHA attestation cannot trigger writes or deployments', () => {
  const manual = readFileSync(
    new URL('../../.github/workflows/verify-easypanel-runtime.yml', import.meta.url),
    'utf8',
  );
  assert.match(manual, /workflow_dispatch:/);
  assert.match(manual, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(manual, /environment: production/);
  assert.match(manual, /EASYPANEL_RELEASE_VERIFY_URL: \$\{\{ vars\.EASYPANEL_RELEASE_VERIFY_URL \}\}/);
  assert.match(manual, /EXPECTED_GIT_SHA: \$\{\{ inputs\.expected_sha \|\| github\.sha \}\}/);
  assert.match(manual, /EASYPANEL_VERIFY_ATTEMPTS: '1'/);
  assert.match(manual, /node scripts\/ci\/verify-easypanel-version\.mjs/);
  assert.doesNotMatch(manual, /curl .*\-X POST|\.auth\.admin\.|DIRECT_URL:|EASYPANEL_WEBHOOK_/);
});

test('all Easypanel deployment webhooks use a bounded single POST attempt', () => {
  // POST webhooks have no idempotency key. An unanswered request may already
  // have triggered a deployment, so retries can produce duplicate releases.
  for (const job of ['deploy-interpreters', 'deploy-roleplay-audio-worker', 'deploy-interpreters-api']) {
    const source = jobBody(job);
    assert.match(source, /--connect-timeout 15 --max-time 120 --retry 0 -X POST/);
    assert.doesNotMatch(source, /--retry-all-errors|--retry [1-9]/);
    assert.match(source, /Easypanel webhook response was not confirmed/);
    assert.match(source, /Inspect Easypanel deployment history and runtime SHA before another request/);
  }
});
