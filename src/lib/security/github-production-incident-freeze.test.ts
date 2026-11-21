// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Regression guard for the emergency freeze while Easypanel/VPS is unreachable.
// Every production-writing job must be disabled by source, not by a mutable
// GitHub variable, input, or the success/skipped state of another job.
const workflow = (name: string) =>
  readFileSync(join(process.cwd(), '.github', 'workflows', name), 'utf8');

function jobBody(source: string, name: string) {
  const marker = `\n  ${name}:\n`;
  const start = source.indexOf(marker);
  expect(start, `Missing protected job ${name}`).toBeGreaterThanOrEqual(0);
  const body = source.slice(start + marker.length);
  const nextJob = body.search(/\n  [a-z][a-z0-9-]*:\n/);
  return nextJob >= 0 ? body.slice(0, nextJob) : body;
}

function expectFrozen(source: string, name: string) {
  const body = jobBody(source, name);
  expect(body.split(/\r?\n/), `Job ${name} must be hard-disabled`).toContain('    if: ${{ false }}');
}

describe('Easypanel incident: production writes stay frozen', () => {
  it('retains CI validation but hard-blocks all three deployment webhook jobs', () => {
    const source = workflow('deploy.yml');
    expect(source).toContain('  pull_request:');
    expect(source).toContain('  push:');
    for (const name of ['deploy-interpreters', 'deploy-interpreters-api', 'deploy-roleplay-audio-worker']) {
      expectFrozen(source, name);
    }
  });

  it('blocks manual production VPN schema modification', () => {
    expectFrozen(workflow('manual-account-vpn-schema-repair.yml'), 'repair-account-vpn-schema');
  });

  it('blocks manual production cron POST and disables inventory queries', () => {
    expectFrozen(workflow('cron-shift-reminders.yml'), 'shift-reminders');
    const source = workflow('orphan-audio-cleanup.yml');
    expectFrozen(source, 'audit');
    expect(source).not.toMatch(/^  schedule:/m);
  });
});
