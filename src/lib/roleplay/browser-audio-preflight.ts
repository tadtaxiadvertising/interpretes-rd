import { ROLEPLAY_MAX_SCENARIOS } from '@/lib/roleplay-limits';
import { getAdminRoleplayAudioExtension } from '@/lib/roleplay/admin-audio-extension';
import { ROLEPLAY_DIRECT_UPLOAD_MAX_FILE_BYTES } from '@/lib/roleplay/direct-upload-contract';

/**
 * Last browser-side check before building the legacy multipart request.
 *
 * This is UX/preflight only; the server must continue to validate independently.
 * No file bytes are read and the 25-clip capability is not reduced.
 */
export function inspectRoleplayAdminAudioDraft(
  scenarios: readonly { baseAudioFile: Pick<File, 'size' | 'type'> | null; sha256?: string }[],
): { totalBytes: number; invalid?: { index: number; message: string } } {
  if (scenarios.length < 1 || scenarios.length > ROLEPLAY_MAX_SCENARIOS) {
    return { totalBytes: 0, invalid: { index: 0, message: 'Cantidad de escenarios inválida.' } };
  }
  let totalBytes = 0;
  for (const [index, scenario] of scenarios.entries()) {
    const file = scenario.baseAudioFile;
    if (!file) {
      return {
        totalBytes,
        invalid: { index, message: `El escenario ${index + 1} necesita un audio válido.` },
      };
    }
    if (!Number.isSafeInteger(file.size) || file.size < 1 ||
        file.size > ROLEPLAY_DIRECT_UPLOAD_MAX_FILE_BYTES) {
      return {
        totalBytes,
        invalid: { index, message: `El audio del escenario ${index + 1} debe pesar entre 1 byte y 15 MiB.` },
      };
    }
    if (typeof file.type !== 'string' || !getAdminRoleplayAudioExtension(file.type)) {
      return {
        totalBytes,
        invalid: { index, message: `El audio del escenario ${index + 1} debe ser MP3, WAV, WebM o MP4.` },
      };
    }
    if (scenario.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(scenario.sha256)) {
      return {
        totalBytes,
        invalid: { index, message: `El escenario ${index + 1} tiene una huella SHA-256 inválida. Vuelve a importar el audio.` },
      };
    }
    totalBytes += file.size;
  }
  return { totalBytes };
}
