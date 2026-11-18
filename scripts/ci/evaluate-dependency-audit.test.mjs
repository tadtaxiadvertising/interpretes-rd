import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { evaluateDependencyAudit } from './evaluate-dependency-audit.mjs';

function validReport(counts = {}) {
  const vulnerabilities = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, ...counts };
  return {
    metadata: { vulnerabilities: {
      ...vulnerabilities,
      total: Object.values(vulnerabilities).reduce((sum, value) => sum + value, 0),
    } },
    vulnerabilities: {},
  };
}

describe('npm audit release gate fails closed', () => {
  it('allows a zero-high report, including warnings for moderate vulnerabilities', () => {
    assert.equal(evaluateDependencyAudit(validReport()).blocksDeployment, false);
    assert.equal(evaluateDependencyAudit(validReport({ moderate: 2 })).blocksDeployment, false);
  });

  it('blocks high and critical vulnerabilities without suppressing them', () => {
    assert.equal(evaluateDependencyAudit(validReport({ high: 1 })).blocksDeployment, true);
    assert.equal(evaluateDependencyAudit(validReport({ critical: 1 })).blocksDeployment, true);
  });

  it('rejects network errors that do not contain vulnerability counts', () => {
    assert.throws(() => evaluateDependencyAudit({ error: { code: 'EAUDITENDPOINT' } }));
    assert.throws(() => evaluateDependencyAudit({}));
    assert.throws(() => evaluateDependencyAudit(null));
  });

  it('rejects structurally invalid or incomplete counts', () => {
    const missing = validReport();
    delete missing.metadata.vulnerabilities.high;
    assert.throws(() => evaluateDependencyAudit(missing));
    const invalid = validReport();
    invalid.metadata.vulnerabilities.high = '0';
    assert.throws(() => evaluateDependencyAudit(invalid));
    const inconsistent = validReport();
    inconsistent.metadata.vulnerabilities.total = 1;
    assert.throws(() => evaluateDependencyAudit(inconsistent));
  });

  it('requires the actual package inventory even when counts say zero', () => {
    const report = validReport();
    delete report.vulnerabilities;
    assert.throws(() => evaluateDependencyAudit(report));
    assert.throws(() => evaluateDependencyAudit({ ...validReport(), vulnerabilities: [] }));
  });

  it('wires the fail-closed parser into the mandatory deployment gate', () => {
    const workflow = readFileSync(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8');
    const start = workflow.indexOf('      - name: Dependency Security Audit');
    const end = workflow.indexOf('      - name: Prisma Validate', start);
    assert.ok(start >= 0 && end > start, 'required dependency audit step must exist');
    const audit = workflow.slice(start, end);
    assert.match(audit, /id: dependency_security_audit/);
    assert.match(audit, /node scripts\/ci\/evaluate-dependency-audit\.mjs/);
    assert.match(workflow, /- name: Verify npm audit fail-closed parser/);
    assert.match(workflow, /if: always\(\) && steps\.dependency_security_audit\.outcome == 'failure'/);
    assert.match(workflow, /needs: validate/);
  });

  it('rejects an audit error object even when other fields look valid', () => {
    assert.throws(() => evaluateDependencyAudit({ ...validReport(), error: { code: 'ENOTFOUND' } }));
  });
});
