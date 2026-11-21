/**
 * Run before npm install / compilation inside any production Docker build.
 * The previous VPS profile (~457 MiB RAM) cannot safely compile a Next.js
 * production image with a Node heap budget as large as 2 GiB.
 *
 * This deliberately does not try to fix a running server. Build preflight
 * refuses undersized builders so operators can move builds off-host.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const MIB = 1024 * 1024;
export const MIN_TOTAL_MIB = 3072;
export const MIN_AVAILABLE_MIB = 2048;

function memInfoKiB(text, label) {
  const match = typeof text === 'string' && text.match(new RegExp('^' + label + ':\\s+(\\d+)\\s+kB', 'm'));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function cgroupBytes(text) {
  if (typeof text !== 'string' || !/^\d+$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

export function assessMemory({ memInfo, cgroupLimit, cgroupUsage }) {
  const hostTotal = memInfoKiB(memInfo, 'MemTotal');
  const hostAvailable = memInfoKiB(memInfo, 'MemAvailable');
  if (hostTotal === null || hostAvailable === null) return { ok: false, reason: 'MEMORY_UNKNOWN' };

  let totalBytes = hostTotal * 1024;
  let availableBytes = hostAvailable * 1024;
  const limit = cgroupBytes(cgroupLimit);
  if (limit !== null && limit < totalBytes) {
    const usage = cgroupBytes(cgroupUsage);
    if (usage === null) return { ok: false, reason: 'CGROUP_USAGE_UNKNOWN' };
    totalBytes = limit;
    availableBytes = Math.min(availableBytes, Math.max(0, limit - usage));
  }
  const totalMiB = Math.floor(totalBytes / MIB);
  const availableMiB = Math.floor(availableBytes / MIB);
  return {
    ok: totalMiB >= MIN_TOTAL_MIB && availableMiB >= MIN_AVAILABLE_MIB,
    reason: totalMiB < MIN_TOTAL_MIB ? 'TOTAL_TOO_LOW'
      : availableMiB < MIN_AVAILABLE_MIB ? 'AVAILABLE_TOO_LOW' : 'OK',
    totalMiB,
    availableMiB,
  };
}

function readOptional(path) {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

export function checkBuildMemory(read = readOptional) {
  const cgroupLimit = read('/sys/fs/cgroup/memory.max')
    ?? read('/sys/fs/cgroup/memory/memory.limit_in_bytes');
  const cgroupUsage = read('/sys/fs/cgroup/memory.current')
    ?? read('/sys/fs/cgroup/memory/memory.usage_in_bytes');
  return assessMemory({
    memInfo: read('/proc/meminfo'),
    cgroupLimit,
    cgroupUsage,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = checkBuildMemory();
  if (!result.ok) {
    console.error(
      'Build rejected: insufficient verified memory for safe production compilation ' +
      '(' + result.reason + '). This is a build-host safety check; use a remote ' +
      'builder with at least ' + MIN_TOTAL_MIB + ' MiB total / ' +
      MIN_AVAILABLE_MIB + ' MiB available. No deployment was requested.'
    );
    process.exitCode = 78;
  } else {
    console.log('Safe build-host memory preflight passed.');
  }
}
