import { STUDIO_DRAFT_FORMAT } from './draft';
import { LOCAL_DRAFT_FORMAT } from './long-media';

export type StudioProjectFormat = 'sampled-local' | 'complete-sha256';

/**
 * Recognize the project's declared format before reading the original media.
 * This is NOT validation of the project or its source binding: the specific
 * open*Draft() parser MUST still validate all fields and its source fingerprint.
 *
 * Never infer the format from a filename or the editor's export setting.
 */
export function detectStudioProjectFormat(json: string): StudioProjectFormat {
  let parsed: unknown;
  try { parsed = JSON.parse(json); }
  catch { throw new Error('El proyecto JSON no es válido.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
      !('format' in parsed) || !('version' in parsed) || parsed.version !== 1) {
    throw new Error('El proyecto JSON no tiene un formato o versión compatible.');
  }
  if (parsed.format === LOCAL_DRAFT_FORMAT) return 'sampled-local';
  if (parsed.format === STUDIO_DRAFT_FORMAT) return 'complete-sha256';
  throw new Error('Este formato de proyecto JSON no es compatible con Audio Studio.');
}
