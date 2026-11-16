import { ROLEPLAY_MAX_SCENARIOS, ROLEPLAY_RESPONSE_MAX_DURATION_SEC } from '@/lib/roleplay-limits';
import type { StudioLanguage, StudioSpeakerRole } from './speaker-profiles';
import type { StudioDraftSegment } from './draft';

export const MAX_LOCAL_MEDIA_BYTES = 8 * 1024 * 1024 * 1024;
export const MAX_LOCAL_MEDIA_SECONDS = 12 * 3600;
export const DIRECT_ZIP_MAX_BYTES = 15 * 1024 * 1024;
export const DIRECT_ZIP_MAX_SECONDS = 7200;
export const LOCAL_DRAFT_MAX_CHARS = 180_000;
export const FINGERPRINT_SAMPLE_BYTES = 128 * 1024;
export const LOCAL_DRAFT_FORMAT = 'interpretes-rd-studio-long-local-project';

const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'wav', 'aac', 'ogg', 'oga', 'opus', 'flac']);
const ROLES: readonly StudioSpeakerRole[] = ['doctor', 'patient', 'nurse', 'operator', 'interpreter', 'unknown'];
const LANGUAGES: readonly StudioLanguage[] = ['en', 'es', 'unknown'];
export type LocalMediaKind = 'audio' | 'video';

interface LocalDraft {
  format: typeof LOCAL_DRAFT_FORMAT;
  version: 1;
  sourceSizeBytes: number;
  sourceSampleSha256: string;
  sourceDurationSeconds: number;
  segments: StudioDraftSegment[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function mediaKind(file: File): LocalMediaKind {
  const extension = file.name.toLowerCase().split('.').pop() || '';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  throw new Error('Formato no admitido. Usa MP3, M4A, WAV, AAC, OGG, FLAC, MP4, MOV, WebM o MKV.');
}

export function validateLocalMedia(file: File): LocalMediaKind {
  const kind = mediaKind(file);
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_LOCAL_MEDIA_BYTES) {
    throw new Error('Selecciona un archivo local válido de hasta 8 GiB.');
  }
  return kind;
}

/**
 * Standard MP3 sources still use the established server ZIP export.
 * Large sources and videos stay completely on the administrator's device.
 */
export function usesLocalLongMode(file: File, duration: number): boolean {
  return mediaKind(file) !== 'audio' || !/\.mp3$/i.test(file.name) ||
    file.size > DIRECT_ZIP_MAX_BYTES || duration > DIRECT_ZIP_MAX_SECONDS;
}

function isStudioSegment(value: unknown, duration: number): value is StudioDraftSegment {
  if (!isRecord(value)) return false;
  return typeof value.title === 'string' && value.title.trim().length > 0 &&
    value.title.length <= 200 &&
    typeof value.start === 'number' && Number.isFinite(value.start) && value.start >= 0 &&
    typeof value.end === 'number' && Number.isFinite(value.end) &&
    value.end - value.start >= 0.1 && value.end - value.start <= 300 &&
    value.end <= duration + 0.1 &&
    typeof value.scriptPrompt === 'string' && value.scriptPrompt.length <= 5000 &&
    typeof value.responseLimit === 'number' && Number.isSafeInteger(value.responseLimit) &&
    value.responseLimit >= 0 && value.responseLimit <= ROLEPLAY_RESPONSE_MAX_DURATION_SEC &&
    ROLES.includes(value.speakerRole as StudioSpeakerRole) &&
    LANGUAGES.includes(value.language as StudioLanguage);
}

function onlyFields(source: StudioDraftSegment): StudioDraftSegment {
  return {
    title: source.title,
    start: source.start,
    end: source.end,
    scriptPrompt: source.scriptPrompt,
    responseLimit: source.responseLimit,
    speakerRole: source.speakerRole,
    language: source.language,
  };
}

function checkedSource(size: number, duration: number, sha: string): void {
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_LOCAL_MEDIA_BYTES ||
    !Number.isFinite(duration) || duration <= 0 || duration > MAX_LOCAL_MEDIA_SECONDS ||
    !/^[0-9a-f]{64}$/i.test(sha)) {
    throw new Error('El archivo, su duración o su huella parcial no son válidos.');
  }
}

/**
 * Bounded-memory sample fingerprint. It is NOT a whole-file SHA-256:
 * verification checks metadata and sampled regions, not every byte.
 * File is never uploaded or fully read into JS memory.
 */
export async function fingerprintLocalMedia(file: File): Promise<string> {
  validateLocalMedia(file);
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Usa HTTPS o localhost para guardar el proyecto con huella SHA-256.');
  }
  const offsets = [
    0,
    Math.max(0, Math.floor(file.size / 2) - Math.floor(FINGERPRINT_SAMPLE_BYTES / 2)),
    Math.max(0, file.size - FINGERPRINT_SAMPLE_BYTES),
  ];
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [encoder.encode('ir-studio-long-v1|' + file.size + '|')];
  for (const offset of offsets) {
    const byteCount = Math.min(FINGERPRINT_SAMPLE_BYTES, file.size - offset);
    parts.push(encoder.encode(offset + '|' + byteCount + '|'));
    parts.push(new Uint8Array(await file.slice(offset, offset + byteCount).arrayBuffer()));
  }
  const total = parts.reduce((n, part) => n + part.byteLength, 0);
  const payload = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) { payload.set(part, cursor); cursor += part.byteLength; }
  const digest = await crypto.subtle.digest('SHA-256', payload);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function createLongMediaDraft(
  sourceSizeBytes: number, sourceSampleSha256: string, segments: readonly StudioDraftSegment[],
  sourceDurationSeconds: number,
): LocalDraft {
  checkedSource(sourceSizeBytes, sourceDurationSeconds, sourceSampleSha256);
  if (segments.length > ROLEPLAY_MAX_SCENARIOS ||
      !segments.every(segment => isStudioSegment(segment, sourceDurationSeconds))) {
    throw new Error('El proyecto contiene intervenciones fuera de los límites permitidos.');
  }
  return {
    format: LOCAL_DRAFT_FORMAT,
    version: 1,
    sourceSizeBytes,
    sourceSampleSha256: sourceSampleSha256.toLowerCase(),
    sourceDurationSeconds,
    segments: segments.map(onlyFields),
  };
}

export function openLongMediaDraft(
  raw: string, sourceSizeBytes: number, sourceSampleSha256: string, sourceDurationSeconds: number,
): StudioDraftSegment[] {
  checkedSource(sourceSizeBytes, sourceDurationSeconds, sourceSampleSha256);
  if (!raw || raw.length > LOCAL_DRAFT_MAX_CHARS) {
    throw new Error('El proyecto JSON está vacío o supera 180 KB.');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('El proyecto no contiene JSON válido.'); }
  if (!isRecord(parsed) || parsed.format !== LOCAL_DRAFT_FORMAT || parsed.version !== 1 ||
    !Number.isSafeInteger(parsed.sourceSizeBytes) ||
    typeof parsed.sourceSampleSha256 !== 'string' ||
    typeof parsed.sourceDurationSeconds !== 'number' ||
    !Number.isFinite(parsed.sourceDurationSeconds) ||
    !Array.isArray(parsed.segments) ||
    parsed.segments.length > ROLEPLAY_MAX_SCENARIOS ||
    !parsed.segments.every(segment => isStudioSegment(segment, sourceDurationSeconds))) {
    throw new Error('El proyecto local está incompleto o contiene intervenciones no válidas.');
  }
  if (parsed.sourceSizeBytes !== sourceSizeBytes ||
    parsed.sourceSampleSha256.toLowerCase() !== sourceSampleSha256.toLowerCase() ||
    Math.abs(parsed.sourceDurationSeconds - sourceDurationSeconds) > 0.5) {
    throw new Error('El proyecto pertenece a otra grabación. Selecciona el archivo local original.');
  }
  return (parsed.segments as StudioDraftSegment[]).map(onlyFields);
}
