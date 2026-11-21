/**
 * Approve off-host image builds only after independent CI workflows for the
 * exact current main SHA have completed successfully.
 * Never connects to the VPS, registry or Easypanel.
 */
import { pathToFileURL } from 'node:url';

export const REQUIRED_WORKFLOWS = Object.freeze([
  '.github/workflows/deploy.yml',
  '.github/workflows/static-quality.yml',
  '.github/workflows/isolated-integration.yml',
]);

const shaPattern = /^[0-9a-f]{40}$/i;
const repoPattern = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

export function assessOffhostApproval({ expectedSha, branchSha, workflowRuns, totalCount }) {
  if (!shaPattern.test(expectedSha ?? '') || !shaPattern.test(branchSha ?? '')) {
    return { ok: false, code: 'INVALID_SHA' };
  }
  if (expectedSha.toLowerCase() !== branchSha.toLowerCase()) {
    return { ok: false, code: 'MAIN_MOVED' };
  }
  if (!Array.isArray(workflowRuns) || !Number.isInteger(totalCount) ||
      totalCount < 0 || totalCount > 100 || workflowRuns.length > 100) {
    return { ok: false, code: 'INCOMPLETE_EVIDENCE' };
  }
  for (const path of REQUIRED_WORKFLOWS) {
    const candidates = workflowRuns.filter(run =>
      run && run.path === path && run.event === 'push' &&
      run.head_branch === 'main' && run.head_sha?.toLowerCase() === expectedSha.toLowerCase() &&
      Number.isSafeInteger(run.id) && run.id > 0
    );
    if (!candidates.length) return { ok: false, code: 'MISSING_CHECK' };
    // If a newer attempt is pending/failing, an older success cannot approve it.
    const latest = candidates.reduce((a, b) => b.id > a.id ? b : a);
    if (latest.status !== 'completed' || latest.conclusion !== 'success') {
      return { ok: false, code: 'CHECK_NOT_GREEN' };
    }
  }
  return { ok: true, code: 'APPROVED' };
}

async function githubJson(path, token, fetchFn = fetch) {
  const response = await fetchFn('https://api.github.com' + path, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('GitHub check unavailable');
  return response.json();
}

export async function verifyReleaseGate(env = process.env, fetchFn = fetch) {
  if (env.GITHUB_ACTIONS !== 'true' || env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
      env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REF !== 'refs/heads/main' ||
      !shaPattern.test(env.GITHUB_SHA ?? '') || !repoPattern.test(env.GITHUB_REPOSITORY ?? '') ||
      !env.GITHUB_TOKEN) {
    return { ok: false, code: 'INVALID_CONTEXT' };
  }
  const name = env.GITHUB_REPOSITORY;
  const branch = await githubJson('/repos/' + name + '/branches/main', env.GITHUB_TOKEN, fetchFn);
  const runs = await githubJson('/repos/' + name + '/actions/runs?head_sha=' +
    encodeURIComponent(env.GITHUB_SHA) + '&event=push&per_page=100', env.GITHUB_TOKEN, fetchFn);
  return assessOffhostApproval({
    expectedSha: env.GITHUB_SHA,
    branchSha: branch?.commit?.sha,
    workflowRuns: runs?.workflow_runs,
    totalCount: runs?.total_count,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await verifyReleaseGate();
    if (!result.ok) {
      console.error('::error::Off-host image blocked: approved current main checks not confirmed (' + result.code + ').');
      process.exitCode = 78;
    } else {
      console.log('Approved main SHA verified for off-host image operation.');
    }
  } catch {
    // Never print GitHub responses, credentials, or potentially sensitive URLs.
    console.error('::error::Off-host image blocked: GitHub approval check unavailable.');
    process.exitCode = 78;
  }
}
