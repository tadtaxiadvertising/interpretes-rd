/**
 * Read-only Easypanel network diagnostic. Never sends HTTP, opens the secret
 * webhook path, or prints hosts/IP addresses, URL values, or provider errors.
 */
import dns from 'node:dns/promises';
import net from 'node:net';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const SAFE_TCP_ERRORS = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'EADDRNOTAVAIL']);
const elapsed = (start) => Math.max(0, Math.round(performance.now() - start));

export async function lookupHost(host, timeoutMs = 5000) {
  let timer;
  try {
    return await Promise.race([
      dns.lookup(host, { all: true }),
      new Promise((_, reject) => { timer = setTimeout(() => reject({ code: 'DNS_TIMEOUT' }), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function dialAddress(address, port, family, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let socket;
    let finished = false;
    const finish = (code) => {
      if (finished) return;
      finished = true;
      socket?.destroy();
      resolve(code);
    };
    try {
      socket = net.connect({ host: address, port, family });
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => finish('CONNECTED'));
      socket.once('timeout', () => finish('ETIMEDOUT'));
      socket.once('error', (error) => finish(SAFE_TCP_ERRORS.has(error?.code) ? error.code : 'TCP_ERROR'));
    } catch {
      finish('TCP_ERROR');
    }
  });
}

export async function probeEndpoint(raw, { lookup = lookupHost, dial = dialAddress } = {}) {
  if (!raw || !raw.trim()) return { status: 'MISSING' };
  let url;
  try {
    url = new URL(raw.trim());
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
      return { status: 'INVALID_URL' };
    }
  } catch {
    return { status: 'INVALID_URL' };
  }

  const dnsStart = performance.now();
  let addresses;
  try {
    addresses = await lookup(url.hostname);
  } catch (error) {
    return { status: error?.code === 'DNS_TIMEOUT' ? 'DNS_TIMEOUT' : 'DNS_FAILED', dns_ms: elapsed(dnsStart) };
  }
  const dnsMs = elapsed(dnsStart);
  const candidates = Array.isArray(addresses)
    ? addresses.filter((record) => net.isIP(record?.address) && [4, 6].includes(record?.family)).slice(0, 6)
    : [];
  if (!candidates.length) return { status: 'DNS_EMPTY', dns_ms: dnsMs };

  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  let lastError = 'TCP_ERROR';
  const tcpStart = performance.now();
  for (const candidate of candidates) {
    try {
      const code = await dial(candidate.address, port, candidate.family);
      if (code === 'CONNECTED') {
        return { status: 'TCP_REACHABLE', dns_ms: dnsMs, tcp_ms: elapsed(tcpStart), tested_addresses: candidates.length };
      }
      lastError = SAFE_TCP_ERRORS.has(code) ? code : 'TCP_ERROR';
    } catch {
      lastError = 'TCP_ERROR';
    }
  }
  return { status: 'TCP_UNREACHABLE', reason: lastError, dns_ms: dnsMs,
    tcp_ms: elapsed(tcpStart), tested_addresses: candidates.length };
}

export async function runDiagnostic(env = process.env, write = (message) => process.stdout.write(`${message}\n`)) {
  for (const [name, key] of [
    ['frontend', 'EASYPANEL_WEBHOOK_INTERPRETERS'],
    ['backend', 'EASYPANEL_WEBHOOK_API'],
  ]) {
    // Report only a fixed service identifier and allowlisted numeric/status data.
    const finding = await probeEndpoint(env[key]);
    write(JSON.stringify({ service: name, ...finding }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDiagnostic().catch(() => {
    // Never log thrown exceptions: some system errors contain host addresses.
    process.stderr.write('Connectivity diagnostic failed without exposing endpoint details.\n');
    process.exitCode = 1;
  });
}
