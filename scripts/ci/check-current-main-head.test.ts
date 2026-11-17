import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const script = resolve(process.cwd(), 'scripts/ci/check-current-main-head.sh');
const expected = 'a'.repeat(40);
const newer = 'b'.repeat(40);
const tempDirs: string[] = [];

function checkHead(options: {
  remote?: string;
  ref?: string;
  sha?: string;
  failGit?: boolean;
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'main-deploy-gate-'));
  tempDirs.push(dir);
  const fakeGit = join(dir, 'git');
  const outputFile = join(dir, 'github-output');
  const summaryFile = join(dir, 'github-step-summary');
  writeFileSync(outputFile, '');
  writeFileSync(summaryFile, '');
  // Keep literal Bash parameter expansion separate from JS template literals.
  const fakeGitSource = [
    '#!/usr/bin/env bash',
    'if [[ "${1:-}" != "ls-remote" || "${2:-}" != "--exit-code" || "${3:-}" != "origin" || "${4:-}" != "refs/heads/main" ]]; then',
    '  exit 64',
    'fi',
    'if [[ "${MOCK_GIT_FAIL:-}" == "yes" ]]; then exit 70; fi',
    'echo "${MOCK_HEAD:-} refs/heads/main"',
  ].join('\n') + '\n';
  writeFileSync(fakeGit, fakeGitSource);
  chmodSync(fakeGit, 0o755);

  const child = spawnSync('bash', [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: dir + delimiter + (process.env.PATH || ''),
      GITHUB_REF: options.ref ?? 'refs/heads/main',
      GITHUB_SHA: options.sha ?? expected,
      GITHUB_OUTPUT: outputFile,
      GITHUB_STEP_SUMMARY: summaryFile,
      MOCK_HEAD: options.remote ?? expected,
      MOCK_GIT_FAIL: options.failGit ? 'yes' : 'no',
    },
  });
  return {
    status: child.status,
    output: readFileSync(outputFile, 'utf8'),
    summary: readFileSync(summaryFile, 'utf8'),
    stderr: child.stderr,
    stdout: child.stdout,
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('production main HEAD deployment gate', () => {
  it('allows production steps only for the current main commit', () => {
    const result = checkHead();
    expect(result.status).toBe(0);
    expect(result.output.trim()).toBe('current=true');
    expect(result.summary).toBe('');
  });

  it('skips outdated merges without failing their completed validation', () => {
    const result = checkHead({ remote: newer });
    expect(result.status).toBe(0);
    expect(result.output.trim()).toBe('current=false');
    expect(result.stdout).toContain('Superseded main commit');
    expect(result.summary).toContain('Publicación omitida por cambio de main');
    expect(result.summary).toContain(expected);
    expect(result.summary).toContain(newer);
  });

  it('fails closed when it cannot query the remote branch', () => {
    const result = checkHead({ failGit: true });
    expect(result.status).not.toBe(0);
    expect(result.output).toBe('');
  });

  it('fails closed for an invalid remote SHA', () => {
    const result = checkHead({ remote: 'invalid' });
    expect(result.status).not.toBe(0);
    expect(result.output).toBe('');
  });

  it('rejects execution on branches other than main', () => {
    const result = checkHead({ ref: 'refs/heads/feature/other' });
    expect(result.status).not.toBe(0);
    expect(result.output).toBe('');
  });

  it('rejects missing or malformed GitHub commit context', () => {
    const result = checkHead({ sha: 'not-a-sha' });
    expect(result.status).not.toBe(0);
    expect(result.output).toBe('');
  });
});
