import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function verifiedImageReference(image, pushOutput, remoteDigest) {
  const match = /^((?:ghcr\.io\/)[a-z0-9_.-]+\/[a-z0-9_.-]+):(sha-[a-f0-9]{40}-run-[1-9][0-9]*-attempt-[1-9][0-9]*)$/.exec(image);
  if (!match || !/^sha256:[a-f0-9]{64}$/.test(remoteDigest)) throw new Error('INVALID_IMAGE_EVIDENCE');
  const prefix = match[2] + ': digest: ';
  const lines = pushOutput.split(/\r?\n/).filter(line => line.startsWith(prefix));
  const result = lines.length === 1 && /^sha256:[a-f0-9]{64} size: [1-9][0-9]*$/.test(lines[0].slice(prefix.length))
    ? lines[0].slice(prefix.length).split(' ')[0] : null;
  if (!result || result !== remoteDigest) throw new Error('DIGEST_NOT_CONFIRMED');
  return match[1] + '@' + result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [image, log, remoteDigest] = process.argv.slice(2);
    console.log(verifiedImageReference(image, readFileSync(log, 'utf8'), remoteDigest));
  } catch {
    console.error('::error::Registry publication digest not confirmed. Inspect the existing registry entry before any retry; no deployment was attempted.');
    process.exitCode = 78;
  }
}
