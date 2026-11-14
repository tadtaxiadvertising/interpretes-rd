import { createHash } from 'node:crypto';

/**
 * Hash an already validated File using its stream rather than materializing an
 * additional full-size ArrayBuffer. The multipart parser may still buffer the
 * original upload; this avoids a second 15 MiB allocation per checksum.
 */
export async function sha256RoleplayFile(file: Pick<File, 'stream'>): Promise<string> {
  const hash = createHash('sha256');
  const reader = file.stream().getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
    }
  } finally {
    reader.releaseLock();
  }

  return hash.digest('hex');
}
