import { readdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const workflowsDir = new URL('../../.github/workflows/', import.meta.url);

/**
 * Lightweight, dependency-free integrity guard for the normal GitHub Actions
 * job.steps structure. GitHub remains the authority for full YAML validity.
 * This catches a bad merge that left an empty `- name:` entry in static-quality.
 */
function getStepErrors(content) {
  const lines = content.split(/\r?\n/);
  const errors = [];
  let step = null;
  let job = '(unknown)';
  const names = new Set();

  const flush = () => {
    if (!step) return;
    if (!step.executor) errors.push(`job ${job}: step "${step.name}" has neither run nor uses`);
    step = null;
  };

  for (const line of lines) {
    const jobMatch = /^  ([a-zA-Z][\w-]*):\s*$/.exec(line);
    if (jobMatch) {
      flush();
      job = jobMatch[1];
      names.clear();
      continue;
    }

    const match = /^      - name:\s*(.*?)\s*$/.exec(line);
    if (match) {
      flush();
      if (names.has(match[1])) errors.push(`job ${job}: duplicate step "${match[1]}"`);
      names.add(match[1]);
      step = { name: match[1], executor: false };
      continue;
    }

    // A step may also start with "uses:" and no name.
    if (/^      - (?:uses|run):/.test(line)) {
      flush();
      continue;
    }
    if (step && /^        (?:uses|run):(?:\s|$)/.test(line)) {
      step.executor = true;
    }
  }
  flush();
  return errors;
}

test('all workflow named steps declare exactly one executable action', () => {
  const files = readdirSync(workflowsDir).filter(file => /\.ya?ml$/.test(file));
  assert.ok(files.length > 0, 'no GitHub Actions workflows found');
  const errors = files.flatMap(file => {
    const source = readFileSync(new URL(file, workflowsDir), 'utf8');
    return getStepErrors(source).map(error => `${file}: ${error}`);
  });
  assert.deepEqual(errors, []);
});

test('an orphan or duplicated step introduced by merging two Docker checks is rejected', () => {
  const broken = [
    'jobs:',
    '  quality:',
    '    steps:',
    '      - name: Build dedicated Express API image',
    '      # collision between two independently added workflow steps',
    '      - name: Build dedicated API image with verified TLS',
    '        run: docker build .',
    '      - name: Build dedicated API image with verified TLS',
    '        run: docker build .',
  ].join('\n');
  assert.equal(getStepErrors(broken).length, 2);
  assert.match(getStepErrors(broken)[0], /neither run nor uses/);
  assert.match(getStepErrors(broken)[1], /duplicate step/);
});

test('static quality validates a single Express image build with verified TLS', () => {
  const text = readFileSync(new URL('static-quality.yml', workflowsDir), 'utf8');
  const exact = text.match(/^      - name: Build dedicated Express API image with verified TLS$/gm) ?? [];
  assert.equal(exact.length, 1);
  assert.match(text, /run: docker build --file Dockerfile\.api --tag interpreters-api:static-ci \./);
  assert.equal(getStepErrors(text).length, 0);
});
