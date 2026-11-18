// Fail closed when npm audit cannot return a trustworthy report.
// The full (dev + production) high/critical gate remains mandatory.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const requiredSeverities = ['info', 'low', 'moderate', 'high', 'critical', 'total'];

export function evaluateDependencyAudit(report) {
  const counts = report?.metadata?.vulnerabilities;
  if (report?.error || !counts || typeof counts !== 'object' || Array.isArray(counts)) {
    throw new Error('npm audit did not return vulnerability metadata');
  }
  for (const severity of requiredSeverities) {
    if (!Number.isSafeInteger(counts[severity]) || counts[severity] < 0) {
      throw new Error('npm audit vulnerability counts are incomplete');
    }
  }
  if (counts.total !== counts.info + counts.low + counts.moderate + counts.high + counts.critical) {
    throw new Error('npm audit vulnerability totals are inconsistent');
  }
  if (!report.vulnerabilities || typeof report.vulnerabilities !== 'object' ||
      Array.isArray(report.vulnerabilities)) {
    throw new Error('npm audit vulnerability inventory is missing');
  }

  return {
    counts,
    blocksDeployment: counts.high > 0 || counts.critical > 0,
    vulnerabilities: report.vulnerabilities,
  };
}

function main() {
  try {
    if (process.argv.length !== 3) throw new Error('Expected one audit report path');
    const report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    const result = evaluateDependencyAudit(report);
    console.log('Dependency audit summary:', JSON.stringify(result.counts));
    for (const [name, item] of Object.entries(result.vulnerabilities)) {
      const advisoryUrls = (Array.isArray(item.via) ? item.via : [])
        .filter(entry => entry && typeof entry === 'object')
        .map(entry => entry.url)
        .filter(url => typeof url === 'string' && /^https:\/\//.test(url));
      console.log([
        name,
        'severity=' + item.severity,
        'direct=' + item.isDirect,
        'range=' + item.range,
        'fixAvailable=' + JSON.stringify(item.fixAvailable),
        'advisories=' + advisoryUrls.join(','),
      ].join(' | '));
    }
    if (result.blocksDeployment) {
      console.error('Dependency audit blocked: high/critical vulnerabilities must be resolved.');
      process.exitCode = 1;
    } else if (result.counts.moderate > 0) {
      console.warn('Dependency audit warning: moderate vulnerabilities remain.');
    }
  } catch {
    // Never dump the raw error: npm/network failures can include credentials.
    console.error('Dependency audit unavailable or malformed: fail closed.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
