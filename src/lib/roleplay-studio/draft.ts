import { ROLEPLAY_MAX_SCENARIOS, ROLEPLAY_RESPONSE_MAX_DURATION_SEC } from '@/lib/roleplay-limits';
import type { StudioSpeakerRole, StudioLanguage } from './speaker-profiles';

export interface StudioDraftSegment {
  title: string;
  start: number;
  end: number;
  scriptPrompt: string;
  responseLimit: number;
  speakerRole: StudioSpeakerRole;
  language: StudioLanguage;
}

interface StudioDraft {
  format: 'interpretes-rd-audio-studio-draft';
  version: 1;
  sourceSizeBytes: number;
  sourceSha256: string;
  segments: StudioDraftSegment[];
}

export const MAX_STUDIO_DRAFT_CHARS = 180_000;
const MAX_ORIGINAL_AUDIO_BYTES = 15 * 1024 * 1024;
const MAX_ORIGINAL_AUDIO_SECONDS = 7200;
const FORMAT = 'interpretes-rd-audio-studio-draft';
const ROLES: readonly StudioSpeakerRole[] = ['doctor', 'patient', 'interpreter', 'nurse', 'operator', 'unknown'];
const LANGUAGES: readonly StudioLanguage[] = ['en', 'es', 'unknown'];

function isRecord(item: unknown): item is Record<string, unknown> {
  return typeof item === 'object' && item !== null && !Array.isArray(item);
}

function validHash(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value);
}

function isDraftSegment(value: unknown, audioDuration: number): value is StudioDraftSegment {
  if (!isRecord(value)) return false;
  return typeof value.title === 'string' && value.title.trim().length > 0 &&
    value.title.length <= 200 &&
    typeof value.start === 'number' && Number.isFinite(value.start) && value.start >= 0 &&
    typeof value.end === 'number' && Number.isFinite(value.end) && value.end > value.start &&
    value.end - value.start >= 0.1 && value.end - value.start <= 300 &&
    value.end <= audioDuration + 0.1 &&
    typeof value.responseLimit === 'number' && Number.isSafeInteger(value.responseLimit) &&
    value.responseLimit >= 0 && value.responseLimit <= ROLEPLAY_RESPONSE_MAX_DURATION_SEC &&
    typeof value.scriptPrompt === 'string' && value.scriptPrompt.length <= 5000 &&
    ROLES.includes(value.speakerRole as StudioSpeakerRole) &&
    LANGUAGES.includes(value.language as StudioLanguage);
}

function onlyDraftFields(source: StudioDraftSegment): StudioDraftSegment {
  return {
    title: source.title, start: source.start, end: source.end,
    scriptPrompt: source.scriptPrompt, responseLimit: source.responseLimit,
    speakerRole: source.speakerRole, language: source.language,
  };
}

/**
 * Explicit, portable snapshot, not a copy of current React state.
 * No audio, filenames, object URLs, private caption text, user identity or
 * media blobs can enter the saved project through a spread.
 */
export function createStudioDraft(
  sourceSizeBytes: number, sourceSha256: string, segments: readonly StudioDraftSegment[],
  audioDuration: number,
): StudioDraft {
  if (!Number.isSafeInteger(sourceSizeBytes) || sourceSizeBytes < 1 ||
      sourceSizeBytes > MAX_ORIGINAL_AUDIO_BYTES || !validHash(sourceSha256) ||
      !Number.isFinite(audioDuration) || audioDuration <= 0 || audioDuration > MAX_ORIGINAL_AUDIO_SECONDS ||
      segments.length > ROLEPLAY_MAX_SCENARIOS ||
      !segments.every(segment => isDraftSegment(segment, audioDuration))) {
    throw new Error('El borrador contiene intervenciones incompletas o límites inválidos.');
  }
  return {
    format: FORMAT,
    version: 1,
    sourceSizeBytes,
    sourceSha256: sourceSha256.toLowerCase(),
    segments: segments.map(onlyDraftFields),
  };
}

export function openStudioDraft(
  json: string, sourceSizeBytes: number, sourceSha256: string, audioDuration: number,
): StudioDraftSegment[] {
  if (!Number.isFinite(audioDuration) || audioDuration <= 0 || audioDuration > MAX_ORIGINAL_AUDIO_SECONDS) {
    throw new Error('La duración del audio original no es válida para este proyecto.');
  }
  if (!json || json.length > MAX_STUDIO_DRAFT_CHARS) {
    throw new Error('El proyecto JSON está vacío o supera el tamaño permitido.');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(json); }
  catch { throw new Error('El archivo de proyecto no contiene JSON válido.'); }

  if (!isRecord(parsed) || parsed.format !== FORMAT || parsed.version !== 1 ||
      !Number.isSafeInteger(parsed.sourceSizeBytes) ||
      typeof parsed.sourceSha256 !== 'string' || !validHash(parsed.sourceSha256) ||
      !Array.isArray(parsed.segments) ||
      parsed.segments.length > ROLEPLAY_MAX_SCENARIOS ||
      !parsed.segments.every((segment: unknown) => isDraftSegment(segment, audioDuration))) {
    throw new Error('Proyecto incompatible, dañado o con límites de intervención inválidos.');
  }
  if (parsed.sourceSizeBytes !== sourceSizeBytes ||
      parsed.sourceSha256.toLowerCase() !== sourceSha256.toLowerCase()) {
    throw new Error('Este proyecto pertenece a otro MP3. Selecciona la grabación original correcta.');
  }
  return (parsed.segments as StudioDraftSegment[]).map(onlyDraftFields);
}

/** Compute SHA-256 only on explicit save/open actions, not during playback. */
export async function sha256StudioAudio(file: File): Promise<string> {
  if (file.size < 1 || file.size > MAX_ORIGINAL_AUDIO_BYTES) {
    throw new Error('El audio debe ser un MP3 de hasta 15 MiB.');
  }
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('El navegador debe utilizar HTTPS para guardar o abrir proyectos verificados.');
  }
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
